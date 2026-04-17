import mongoose from 'mongoose';

const trackMetaSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  titleLower: {
    type: String,
    required: true,
  },
  artist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Artist',
    required: true,
  },
  album: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Album',
    default: null,
  },

  // Track properties (enriched over time)
  duration: {
    type: Number, // in seconds
  },
  trackNumber: {
    type: Number,
  },
  genre: {
    type: String,
    trim: true,
  },

  // Track URLs
  trackUrl: {
    type: String, // URL on Last.fm
  },
  lastfmMbid: {
    type: String,
  },
  lastfmTrackId: {
    type: String,
  },

  // Spotify data
  spotify: {
    id: String,
    uri: String,
    url: String,
    popularity: Number,
    preview_url: String,
    duration_ms: Number,
    explicit: Boolean,
    track_number: Number,
    disc_number: Number,
    is_local: Boolean,

    artist: {
      id: String,
      name: String,
      uri: String,
      url: String,
    },

    all_artists: [{
      id: String,
      name: String,
      uri: String,
      url: String,
    }],

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
        width: Number,
      }],
    },

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
      time_signature: Number,
    },

    search_confidence: Number,
    fetched_at: Date,
  },

  // Spotify enrichment status
  spotify_enriched: {
    type: Boolean,
    default: false,
  },
  spotify_search_attempted: {
    type: Boolean,
    default: false,
  },
  spotify_match_found: {
    type: Boolean,
    default: false,
  },

  // Animation (Apple Music) enrichment
  animationUrl: {
    type: String,
  },
  masterTallUrl: {
    type: String,
  },
  primaryMediaUrl: {
    type: String,
  },
  primaryMediaType: {
    type: String,
    trim: true,
  },
  animation_search_attempted: {
    type: Boolean,
    default: false,
  },
  animation_match_found: {
    type: Boolean,
    default: false,
  },
  appleMusicUrl: {
    type: String,
  },

  // Cover art (track-level, may differ from album art)
  trackArtUrl: {
    type: String,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Compound unique index: one track per artist (case-insensitive)
trackMetaSchema.index({ titleLower: 1, artist: 1 }, { unique: true });
trackMetaSchema.index({ spotify_enriched: 1 });
trackMetaSchema.index({ spotify_search_attempted: 1 });
trackMetaSchema.index({ 'spotify.id': 1 });
trackMetaSchema.index({ animation_search_attempted: 1 });

// ──────────────────────────────────────────────
// Virtuals
// ──────────────────────────────────────────────

trackMetaSchema.virtual('formattedDuration').get(function () {
  if (!this.duration) return 'Unknown';
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

// ──────────────────────────────────────────────
// Static Methods
// ──────────────────────────────────────────────

/**
 * Find or create a TrackMeta by title + artist ref (case-insensitive upsert).
 *
 * @param {string} title - Track display title.
 * @param {ObjectId} artistId - Reference to the Artist document.
 * @param {ObjectId|null} albumId - Reference to the Album document (optional).
 * @param {Object} [extra] - Optional extra fields.
 * @returns {Promise<Document>}
 */
trackMetaSchema.statics.findOrCreateByIdentity = async function (title, artistId, albumId = null, extra = {}) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new Error('Track title is required');
  }

  const trimmed = title.trim();
  const lower = trimmed.toLowerCase();

  let trackMeta = await this.findOne({ titleLower: lower, artist: artistId });
  if (trackMeta) {
    let dirty = false;
    if (albumId && !trackMeta.album) { trackMeta.album = albumId; dirty = true; }
    if (extra.duration && !trackMeta.duration) { trackMeta.duration = extra.duration; dirty = true; }
    if (extra.trackNumber && !trackMeta.trackNumber) { trackMeta.trackNumber = extra.trackNumber; dirty = true; }
    if (extra.genre && !trackMeta.genre) { trackMeta.genre = extra.genre; dirty = true; }
    if (extra.trackUrl && !trackMeta.trackUrl) { trackMeta.trackUrl = extra.trackUrl; dirty = true; }
    if (extra.trackArtUrl && !trackMeta.trackArtUrl) { trackMeta.trackArtUrl = extra.trackArtUrl; dirty = true; }
    if (extra.lastfmMbid && !trackMeta.lastfmMbid) { trackMeta.lastfmMbid = extra.lastfmMbid; dirty = true; }
    if (extra.animationUrl && !trackMeta.animationUrl) { trackMeta.animationUrl = extra.animationUrl; dirty = true; }
    if (extra.appleMusicUrl && !trackMeta.appleMusicUrl) { trackMeta.appleMusicUrl = extra.appleMusicUrl; dirty = true; }
    if (extra.masterTallUrl && !trackMeta.masterTallUrl) { trackMeta.masterTallUrl = extra.masterTallUrl; dirty = true; }
    if (extra.primaryMediaUrl && !trackMeta.primaryMediaUrl) { trackMeta.primaryMediaUrl = extra.primaryMediaUrl; dirty = true; }
    if (extra.spotify && !trackMeta.spotify) { trackMeta.spotify = extra.spotify; dirty = true; }
    if (dirty) await trackMeta.save();
    return trackMeta;
  }

  try {
    trackMeta = await this.create({
      title: trimmed,
      titleLower: lower,
      artist: artistId,
      album: albumId,
      ...extra,
    });
    return trackMeta;
  } catch (err) {
    if (err.code === 11000) {
      return this.findOne({ titleLower: lower, artist: artistId });
    }
    throw err;
  }
};

// ──────────────────────────────────────────────
// Instance Methods (moved from Track.js)
// ──────────────────────────────────────────────

trackMetaSchema.methods.setSpotifyData = function (spotifyData, confidence = 1.0) {
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
    fetched_at: new Date(),
  };

  this.spotify_enriched = true;
  this.spotify_search_attempted = true;
  this.spotify_match_found = true;

  // Fill missing basic data from Spotify
  if (spotifyData.duration_seconds && (!this.duration || this.duration === null)) {
    this.duration = spotifyData.duration_seconds;
  }

  if (spotifyData.track_number && (!this.trackNumber || this.trackNumber === null)) {
    this.trackNumber = spotifyData.track_number;
  }

  return this;
};

trackMetaSchema.methods.setSpotifyAudioFeatures = function (audioFeatures) {
  if (!this.spotify) {
    this.spotify = {};
  }
  this.spotify.audio_features = audioFeatures;
  return this;
};

trackMetaSchema.methods.markSpotifySearchAttempted = function (matchFound = false) {
  this.spotify_search_attempted = true;
  this.spotify_match_found = matchFound;
  if (!matchFound) {
    this.spotify_enriched = false;
  }
  return this;
};

// ──────────────────────────────────────────────
// Static Query Helpers
// ──────────────────────────────────────────────

trackMetaSchema.statics.findWithoutSpotifyData = function (limit = 100) {
  return this.find({
    spotify_search_attempted: { $ne: true },
  })
    .sort({ updatedAt: -1 })
    .limit(limit);
};

trackMetaSchema.statics.findSpotifyEnriched = function (limit = 50) {
  return this.find({
    spotify_enriched: true,
    spotify_match_found: true,
  })
    .sort({ updatedAt: -1 })
    .limit(limit);
};

trackMetaSchema.statics.getSpotifyStats = function () {
  return this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        spotify_enriched: {
          $sum: { $cond: [{ $eq: ['$spotify_enriched', true] }, 1, 0] },
        },
        spotify_search_attempted: {
          $sum: { $cond: [{ $eq: ['$spotify_search_attempted', true] }, 1, 0] },
        },
        spotify_match_found: {
          $sum: { $cond: [{ $eq: ['$spotify_match_found', true] }, 1, 0] },
        },
      },
    },
  ]);
};

const TrackMeta = mongoose.model('TrackMeta', trackMetaSchema);

export default TrackMeta;
