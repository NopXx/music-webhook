import mongoose from 'mongoose';
import Artist from './Artist.js';
import Album from './Album.js';
import TrackMeta from './TrackMeta.js';
import {
  SOURCE_VALUES,
  normalizeSource,
  normalizeDate,
  deriveTrackArtUrl,
  buildNormalizedTrackData,
} from '../utils/trackNormalizer.js';

const scrobbleSchema = new mongoose.Schema({
  track: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrackMeta',
    required: true,
    index: true,
  },

  // Scrobble timing
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
  },
  scrobbledAt: {
    type: Date,
    default: Date.now,
  },

  // Source / connector
  source: {
    type: String,
    trim: true,
    lowercase: true,
    default: 'web-scrobbler',
  },
  connector: {
    type: String,
  },
  originalUrl: {
    type: String,
  },

  // Event info
  eventType: {
    type: String,
    enum: ['nowplaying', 'paused', 'scrobble', 'resumed', 'stopped', 'unknown'],
    default: 'unknown',
  },

  // User flags
  isLoved: {
    type: Boolean,
    default: false,
  },
  isLovedInService: {
    type: Boolean,
  },
  playCount: {
    type: Number,
    default: 1,
  },
  userPlayCount: {
    type: Number,
  },

  // Scrobble-specific metadata
  metadataLabel: {
    type: String,
    trim: true,
  },
  albumArtist: {
    type: String,
    trim: true,
  },

  // Status flags
  isScrobbled: {
    type: Boolean,
    default: false,
  },
  isCorrectedByUser: {
    type: Boolean,
    default: false,
  },
  isValid: {
    type: Boolean,
    default: true,
  },

  // Timing
  startTimestamp: {
    type: Date,
  },
  currentTime: {
    type: Number,
  },

  // Request metadata
  userAgent: {
    type: String,
  },
  ipAddress: {
    type: String,
  },
  rawData: {
    type: mongoose.Schema.Types.Mixed,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// ──────────────────────────────────────────────
// Indexes
// ──────────────────────────────────────────────

scrobbleSchema.index({ scrobbledAt: -1 });
scrobbleSchema.index({ timestamp: -1 });
scrobbleSchema.index({ track: 1, scrobbledAt: -1 });
scrobbleSchema.index({ source: 1 });
scrobbleSchema.index({ connector: 1 });
scrobbleSchema.index({ eventType: 1 });

// ──────────────────────────────────────────────
// Static Methods
// ──────────────────────────────────────────────

/**
 * Check if a recent duplicate scrobble exists for the same track within a time window.
 *
 * @param {ObjectId} trackMetaId - The TrackMeta reference.
 * @param {Date} timestamp - The scrobble timestamp.
 * @param {number} windowMs - Dedup window in milliseconds (default 5 min).
 * @returns {Promise<boolean>}
 */
scrobbleSchema.statics.isRecentDuplicate = async function (trackMetaId, timestamp, windowMs = 300000) {
  const ts = new Date(timestamp);
  const start = new Date(ts.getTime() - windowMs);

  const count = await this.countDocuments({
    track: trackMetaId,
    scrobbledAt: { $gte: start },
    eventType: 'scrobble',
  });

  return count > 0;
};

/**
 * Full pipeline: resolve Artist → Album → TrackMeta → create Scrobble.
 * This replaces the old Track.findOrCreateTrack logic.
 *
 * @param {Object} trackData - Normalized track data from the webhook pipeline.
 * @returns {Promise<Object>} Saved scrobble with populated refs + action flag.
 */
scrobbleSchema.statics.findOrCreateScrobble = async function (trackData) {
  // Resolve event type
  const eventType =
    trackData?.eventType ||
    trackData?.eventName ||
    trackData?.data?.eventName ||
    'unknown';

  // Only persist scrobble events
  if (eventType !== 'scrobble') {
    console.log(
      `⏭️ Ignored non-scrobble event: ${trackData?.artist || 'Unknown'} - ${trackData?.title || 'Unknown'} [${eventType}]`
    );
    return {
      action: 'ignored',
      eventType,
      artist: trackData?.artist,
      title: trackData?.title,
    };
  }

  // Normalize the incoming data
  const data = buildNormalizedTrackData(trackData, eventType);

  if (!data.artist || !data.title) {
    console.warn('⚠️ Missing artist/title after normalization, skipping.');
    return { action: 'skipped', eventType, data };
  }

  // ── Step 1: Resolve Artist ────────────────────
  const artistDoc = await Artist.findOrCreateByName(data.artist, {
    artistUrl: data.artistUrl || undefined,
    lastfmMbid: data.lastfmMbid || undefined,
  });

  // ── Step 2: Resolve Album (optional) ──────────
  let albumDoc = null;
  if (data.album && data.album.trim()) {
    albumDoc = await Album.findOrCreateByNameAndArtist(data.album, artistDoc._id, {
      year: data.year || undefined,
      trackArtUrl: data.trackArtUrl || undefined,
      albumUrl: data.albumUrl || undefined,
    });
  }

  // ── Step 3: Resolve TrackMeta ─────────────────
  const trackMeta = await TrackMeta.findOrCreateByIdentity(
    data.title,
    artistDoc._id,
    albumDoc?._id || null,
    {
      duration: data.duration || undefined,
      trackNumber: data.trackNumber || undefined,
      genre: data.genre || undefined,
      trackUrl: data.trackUrl || undefined,
      trackArtUrl: data.trackArtUrl || undefined,
      lastfmMbid: data.lastfmMbid || undefined,
    }
  );

  // ── Step 4: Dedup check ───────────────────────
  const dedupeMode = (process.env.SCROBBLE_DEDUPE || 'off').toLowerCase();
  if (dedupeMode !== 'off') {
    const isDup = await this.isRecentDuplicate(
      trackMeta._id,
      data.scrobbledAt || data.timestamp,
      10 * 60 * 1000 // 10 min window
    );
    if (isDup) {
      console.log(`⏭️ Skipped duplicate: ${data.artist} - ${data.title}`);
      return {
        action: 'skipped',
        eventType,
        trackMeta,
        artist: artistDoc,
        album: albumDoc,
      };
    }
  }

  // ── Step 5: Create Scrobble ───────────────────
  const scrobble = await this.create({
    track: trackMeta._id,
    timestamp: data.timestamp,
    scrobbledAt: data.scrobbledAt,
    source: data.source,
    connector: data.connector,
    originalUrl: data.originalUrl,
    eventType,
    isLoved: data.isLoved || false,
    isLovedInService: data.isLovedInService,
    userPlayCount: data.userPlayCount,
    metadataLabel: data.metadataLabel,
    albumArtist: data.albumArtist,
    isScrobbled: true,
    isCorrectedByUser: data.isCorrectedByUser || false,
    isValid: data.isValid !== false,
    startTimestamp: data.startTimestamp,
    currentTime: data.currentTime,
    userAgent: data.userAgent,
    ipAddress: data.ipAddress,
    rawData: data.rawData,
  });

  console.log(`✨ New scrobble: ${data.artist} - ${data.title} [${eventType}]`);

  // Attach refs for downstream enrichment / response
  scrobble._trackMeta = trackMeta;
  scrobble._artist = artistDoc;
  scrobble._album = albumDoc;
  scrobble.action = 'created';
  scrobble.isNew = true;

  return scrobble;
};

/**
 * Get recent scrobbles with populated track/artist/album data.
 */
scrobbleSchema.statics.getRecentTracks = function (limit = 50) {
  return this.find({ eventType: 'scrobble' })
    .sort({ scrobbledAt: -1 })
    .limit(limit)
    .populate({
      path: 'track',
      populate: [
        { path: 'artist', select: 'name imageUrl artistUrl' },
        { path: 'album', select: 'name trackArtUrl albumUrl year' },
      ],
    });
};

const Scrobble = mongoose.model('Scrobble', scrobbleSchema);

export default Scrobble;
