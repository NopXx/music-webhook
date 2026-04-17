import mongoose from 'mongoose';

const albumSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  nameLower: {
    type: String,
    required: true,
  },
  artist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Artist',
    required: true,
  },
  year: {
    type: Number,
  },
  trackArtUrl: {
    type: String, // Cover art URL
  },
  albumUrl: {
    type: String, // URL on Last.fm or other service
  },
  appleMusicUrl: {
    type: String,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Compound unique index: one album per artist (case-insensitive)
albumSchema.index({ nameLower: 1, artist: 1 }, { unique: true });

// ──────────────────────────────────────────────
// Static Methods
// ──────────────────────────────────────────────

/**
 * Find or create an Album by name + artist ref (case-insensitive upsert).
 *
 * @param {string} name - Album display name.
 * @param {ObjectId} artistId - Reference to the Artist document.
 * @param {Object} [extra] - Optional extra fields (year, trackArtUrl, albumUrl, etc.).
 * @returns {Promise<Document>}
 */
albumSchema.statics.findOrCreateByNameAndArtist = async function (name, artistId, extra = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return null; // Album is optional — return null if not provided
  }

  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  let album = await this.findOne({ nameLower: lower, artist: artistId });
  if (album) {
    // Patch missing fields
    let dirty = false;
    if (extra.year && !album.year) { album.year = extra.year; dirty = true; }
    if (extra.trackArtUrl && !album.trackArtUrl) { album.trackArtUrl = extra.trackArtUrl; dirty = true; }
    if (extra.albumUrl && !album.albumUrl) { album.albumUrl = extra.albumUrl; dirty = true; }
    if (extra.appleMusicUrl && !album.appleMusicUrl) { album.appleMusicUrl = extra.appleMusicUrl; dirty = true; }
    if (dirty) await album.save();
    return album;
  }

  try {
    album = await this.create({
      name: trimmed,
      nameLower: lower,
      artist: artistId,
      ...extra,
    });
    return album;
  } catch (err) {
    if (err.code === 11000) {
      return this.findOne({ nameLower: lower, artist: artistId });
    }
    throw err;
  }
};

const Album = mongoose.model('Album', albumSchema);

export default Album;
