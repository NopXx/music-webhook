import mongoose from 'mongoose';
import {
  SOURCE_VALUES,
  normalizeTrackFields,
  buildNormalizedTrackData,
  normalizeSource,
  normalizeDate,
  deriveTrackArtUrl,
} from '../utils/trackNormalizer.js';

const trackSchema = new mongoose.Schema({
  // Track information
  title: {
    type: String,
    required: true,
    trim: true,
  },
  artist: {
    type: String,
    required: true,
    trim: true,
  },
  album: {
    type: String,
    trim: true,
  },
  albumArtist: {
    type: String,
    trim: true,
  },
  genre: {
    type: String,
    trim: true,
  },
  year: {
    type: Number,
  },
  trackNumber: {
    type: Number,
  },
  duration: {
    type: Number, // in seconds
  },
  
  // Scrobble information
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
  },
  source: {
    type: String,
    trim: true,
    lowercase: true,
    default: 'web-scrobbler',
  },
  scrobbledAt: {
    type: Date,
    default: Date.now,
  },
  
  // Additional metadata
  isLoved: {
    type: Boolean,
    default: false,
  },
  playCount: {
    type: Number,
    default: 1,
  },
  
  // Web-scrobbler specific data
  connector: {
    type: String, // YouTube, Spotify, SoundCloud, etc.
  },
  originalUrl: {
    type: String,
  },
  
  // Last.fm integration data
  lastfmTrackId: {
    type: String,
  },
  lastfmMbid: {
    type: String,
  },
  
  // Web-scrobbler metadata
  userPlayCount: {
    type: Number, // จำนวนครั้งที่ user เล่นเพลงนี้
  },
  trackArtUrl: {
    type: String, // URL ของรูป track art
  },
  artistUrl: {
    type: String, // URL ของ artist บน Last.fm
  },
  trackUrl: {
    type: String, // URL ของ track บน Last.fm
  },
  albumUrl: {
    type: String, // URL ของ album บน Last.fm
  },
  metadataLabel: {
    type: String, // Label จาก metadata (เช่น Apple Music Scrobbler)
    trim: true,
  },
  animationUrl: {
    type: String, // Animation หรือ video ที่แนบมากับ metadata
  },
  masterTallUrl: {
    type: String, // Animation Tall หรือ video ที่แนบมากับ metadata
  },
  primaryMediaUrl: {
    type: String, // Primary media URL จาก metadata
  },
  primaryMediaType: {
    type: String, // ประเภทของ primary media (เช่น video)
    trim: true,
  },
  isLovedInService: {
    type: Boolean, // loved ใน service ต้นทาง (Last.fm)
  },
  
  // Scrobble status และ flags
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
  
  // Timing information
  startTimestamp: {
    type: Date, // เวลาที่เริ่มเล่น
  },
  currentTime: {
    type: Number, // เวลาปัจจุบันของเพลง (วินาที)
  },
  eventType: {
    type: String, // nowplaying, paused, scrobble, etc.
    enum: ['nowplaying', 'paused', 'scrobble', 'resumed', 'stopped', 'unknown'],
    default: 'unknown',
  },
  
  // Spotify data
  spotify: {
    id: String, // Spotify track ID
    uri: String, // Spotify URI
    url: String, // Spotify URL
    popularity: Number, // 0-100
    preview_url: String,
    duration_ms: Number,
    explicit: Boolean,
    track_number: Number,
    disc_number: Number,
    is_local: Boolean,
    
    // Artist info from Spotify
    artist: {
      id: String,
      name: String,
      uri: String,
      url: String
    },
    
    // All artists (for collaborations)
    all_artists: [{
      id: String,
      name: String,
      uri: String,
      url: String
    }],
    
    // Album info from Spotify
    album: {
      id: String,
      name: String,
      uri: String,
      url: String,
      release_date: String,
      release_date_precision: String,
      total_tracks: Number,
      album_type: String,
      images: [{
        url: String,
        height: Number,
        width: Number
      }]
    },
    
    // Audio features (optional)
    audio_features: {
      danceability: Number,
      energy: Number,
      key: Number,
      loudness: Number,
      mode: Number,
      speechiness: Number,
      acousticness: Number,
      instrumentalness: Number,
      liveness: Number,
      valence: Number,
      tempo: Number,
      time_signature: Number
    },
    
    // Spotify search metadata
    search_confidence: Number, // 0-1 score ของการ match
    fetched_at: Date
  },
  
  // Spotify enrichment status
  spotify_enriched: {
    type: Boolean,
    default: false
  },
  spotify_search_attempted: {
    type: Boolean,
    default: false
  },
  spotify_match_found: {
    type: Boolean,
    default: false
  },

  // Animation (Apple Music) enrichment status
  animation_search_attempted: {
    type: Boolean,
    default: false
  },
  animation_match_found: {
    type: Boolean,
    default: false
  },
  appleMusicUrl: {
    type: String, // Apple Music URL for the track
  },

  // Metadata
  userAgent: {
    type: String,
  },
  ipAddress: {
    type: String,
  },
  rawData: {
    type: mongoose.Schema.Types.Mixed, // Store original webhook data
  },
}, {
  timestamps: true, // adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for better query performance
trackSchema.index({ artist: 1, title: 1 });
trackSchema.index({ timestamp: -1 });
trackSchema.index({ scrobbledAt: -1 });
trackSchema.index({ source: 1 });
trackSchema.index({ connector: 1 });
trackSchema.index({ 'spotify.id': 1 });
trackSchema.index({ spotify_enriched: 1 });
trackSchema.index({ spotify_match_found: 1 });

// Virtual for full track name
trackSchema.virtual('fullName').get(function() {
  return `${this.artist} - ${this.title}`;
});

// Virtual for formatted duration
trackSchema.virtual('formattedDuration').get(function() {
  if (!this.duration) return 'Unknown';
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

// Pre-save middleware to handle duplicates and cleanup
trackSchema.pre('save', function(next) {
  normalizeTrackFields(this);
  next();
});

// Static methods
trackSchema.statics.findByArtistAndTitle = function(artist, title) {
  return this.find({ 
    artist: new RegExp(artist, 'i'), 
    title: new RegExp(title, 'i') 
  });
};

trackSchema.statics.isRecentDuplicate = async function(artist, title, timestamp, windowMs = 300000) {
  const ts = new Date(timestamp);
  const start = new Date(ts.getTime() - windowMs);
  
  const count = await this.countDocuments({
    artist: artist,
    title: title,
    scrobbledAt: { $gte: start }, // Check strictly after start of window
    eventType: 'scrobble'
  });
  
  return count > 0;
};

// Find or create track within time window
trackSchema.statics.findOrCreateTrack = async function(trackData) {
  // Resolve event type from multiple possible fields
  const eventType =
    trackData?.eventType ||
    trackData?.eventName ||
    trackData?.data?.eventName ||
    'unknown';

  // Only persist scrobble events; ignore others like nowplaying/paused/resumed/stopped
  if (eventType !== 'scrobble') {
    const sr = trackData?.data?.song || trackData?.song || {};
    const _processed = sr?.processed || {};
    const _parsed = sr?.parsed || {};
    const previewArtist = trackData?.artist || _processed.artist || _parsed.artist || 'Unknown';
    const previewTitle = trackData?.title || _processed.track || _parsed.track || 'Unknown';
    console.log(
      `⏭️ Ignored non-scrobble event for persistence: ${previewArtist} - ${previewTitle} [${eventType}]`
    );
    // Return a non-persisted doc-shaped object for upstream handling
    const tempDoc = new this({
      ...trackData,
      eventType,
    });
    tempDoc.isNew = false;
    tempDoc.action = 'ignored';
    return tempDoc;
  }

  // --- Normalize incoming payload using centralized normalizer ---
  const data = buildNormalizedTrackData(trackData, eventType);

  // Validate required identity after normalization
  if (!data.artist || !data.title) {
    const songRoot = trackData?.song || trackData?.data?.song || trackData?.rawData?.data?.song || {};
    console.warn('⚠️ Missing artist/title after normalization, skipping save.', {
      data,
      trackDataSample: {
        eventType,
        processed: songRoot?.processed,
        parsed: songRoot?.parsed,
      },
    });
    const tempDoc = new this({ ...data });
    tempDoc.isNew = false;
    tempDoc.action = 'skipped';
    return tempDoc;
  }

// Dedupe mode: 'off' (default) means always create a new record (no dedupe)
const dedupeMode = (process.env.SCROBBLE_DEDUPE || 'off').toLowerCase();

// Look-back window to dedupe very recent scrobbles from the same connector/session
const timeWindow = 10 * 60 * 1000; // 10 minutes
const now = new Date();
const windowStart = new Date(now.getTime() - timeWindow);

let existingTrack = null;
if (dedupeMode !== 'off') {
  // Find an existing track that matches identity and is within the time window
  existingTrack = await this
    .findOne({
      artist: data.artist,
      title: data.title,
      connector: data.connector,
      $or: [
        { scrobbledAt: { $gte: windowStart } },
        data.startTimestamp ? { startTimestamp: data.startTimestamp } : null,
      ].filter(Boolean),
    })
    .sort({ scrobbledAt: -1 });
}

  if (existingTrack) {
    const shouldUpdate =
      // Always update on scrobble events (highest priority)
      eventType === 'scrobble' ||
      // Or if this is newer data
      (trackData?.timestamp &&
        new Date(trackData.timestamp) > existingTrack.timestamp) ||
      // Or if we now have more complete metadata
      (data.userPlayCount && !existingTrack.userPlayCount);

    if (shouldUpdate) {
      // Merge new data but preserve original creation time
      Object.assign(existingTrack, {
        ...data,
        // Keep original createdAt by not overriding it
      });

      console.log(
        `🔄 Updated: ${existingTrack.artist} - ${existingTrack.title} [${eventType}]`
      );
      const updated = await existingTrack.save();
      updated.isNew = false;
      updated.action = 'updated';
      return updated;
    } else {
      console.log(
        `⏭️ Skipped duplicate: ${existingTrack.artist} - ${existingTrack.title} [${eventType}]`
      );
      existingTrack.isNew = false;
      existingTrack.action = 'skipped';
      return existingTrack;
    }
  } else {
    // Create new track using normalized data
    const newTrack = new this(data);
    console.log(`✨ New track: ${newTrack.artist} - ${newTrack.title} [${eventType}]`);
    const saved = await newTrack.save();
    saved.isNew = true;
    saved.action = 'created';
    return saved;
  }
};

trackSchema.statics.getTopArtists = function(limit = 10) {
  return this.aggregate([
    { $group: { _id: '$artist', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $project: { artist: '$_id', playCount: '$count', _id: 0 } }
  ]);
};

trackSchema.statics.getRecentTracks = function(limit = 50) {
  return this.find()
    .sort({ scrobbledAt: -1 })
    .limit(limit)
    .select('title artist album timestamp source connector');
};

// Instance methods
trackSchema.methods.markAsLoved = function() {
  this.isLoved = true;
  return this.save();
};

trackSchema.methods.incrementPlayCount = function() {
  this.playCount += 1;
  return this.save();
};

// Spotify related methods
trackSchema.methods.setSpotifyData = function(spotifyData, confidence = 1.0) {
  this.spotify = {
    id: spotifyData.spotify_id,
    uri: spotifyData.spotify_uri,
    url: spotifyData.spotify_url,
    popularity: spotifyData.popularity,
    preview_url: spotifyData.preview_url,
    duration_ms: spotifyData.duration_ms,
    explicit: spotifyData.explicit,
    track_number: spotifyData.track_number,
    disc_number: spotifyData.disc_number,
    is_local: spotifyData.is_local,
    artist: spotifyData.artist,
    all_artists: spotifyData.all_artists,
    album: spotifyData.album,
    search_confidence: confidence,
    fetched_at: new Date()
  };
  
  this.spotify_enriched = true;
  this.spotify_search_attempted = true;
  this.spotify_match_found = true;
  
  // เติมข้อมูลพื้นฐานที่ขาดหายไป (เฉพาะที่ไม่มีหรือไม่ครบ)
  // เติม duration ถ้าไม่มี
  if (spotifyData.duration_seconds && (!this.duration || this.duration === null)) {
    this.duration = spotifyData.duration_seconds;
    console.log(`🔧 Added duration: ${this.duration}s for ${this.artist} - ${this.title}`);
  }
  
  // เติม album ถ้าไม่มี
  if (spotifyData.album?.name && (!this.album || this.album.trim() === '')) {
    this.album = spotifyData.album.name;
    console.log(`🔧 Added album: ${this.album} for ${this.artist} - ${this.title}`);
  }
  
  // เติม year ถ้าไม่มี
  if (spotifyData.album?.release_date && (!this.year || this.year === null)) {
    const releaseYear = new Date(spotifyData.album.release_date).getFullYear();
    if (!isNaN(releaseYear)) {
      this.year = releaseYear;
      console.log(`🔧 Added year: ${this.year} for ${this.artist} - ${this.title}`);
    }
  }
  
  // เติม track number ถ้าไม่มี
  if (spotifyData.track_number && (!this.trackNumber || this.trackNumber === null)) {
    this.trackNumber = spotifyData.track_number;
    console.log(`🔧 Added track number: ${this.trackNumber} for ${this.artist} - ${this.title}`);
  }
  
  return this;
};

trackSchema.methods.setSpotifyAudioFeatures = function(audioFeatures) {
  if (!this.spotify) {
    this.spotify = {};
  }
  this.spotify.audio_features = audioFeatures;
  return this;
};

trackSchema.methods.markSpotifySearchAttempted = function(matchFound = false) {
  this.spotify_search_attempted = true;
  this.spotify_match_found = matchFound;
  if (!matchFound) {
    this.spotify_enriched = false;
  }
  return this;
};

// Static methods for Spotify
trackSchema.statics.findWithoutSpotifyData = function(limit = 100) {
  return this.find({
    spotify_search_attempted: { $ne: true },
    eventType: 'scrobble' // เฉพาะ scrobble events
  })
  .sort({ scrobbledAt: -1 })
  .limit(limit);
};

trackSchema.statics.findSpotifyEnriched = function(limit = 50) {
  return this.find({
    spotify_enriched: true,
    spotify_match_found: true
  })
  .sort({ scrobbledAt: -1 })
  .limit(limit);
};

trackSchema.statics.getSpotifyStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        spotify_enriched: {
          $sum: { $cond: [{ $eq: ['$spotify_enriched', true] }, 1, 0] }
        },
        spotify_search_attempted: {
          $sum: { $cond: [{ $eq: ['$spotify_search_attempted', true] }, 1, 0] }
        },
        spotify_match_found: {
          $sum: { $cond: [{ $eq: ['$spotify_match_found', true] }, 1, 0] }
        }
      }
    }
  ]);
};

const Track = mongoose.model('Track', trackSchema);

export default Track;
