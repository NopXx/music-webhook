import mongoose from 'mongoose';

const artistSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  nameLower: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  imageUrl: {
    type: String,
  },
  artistUrl: {
    type: String, // URL of artist on Last.fm or other service
  },
  lastfmMbid: {
    type: String,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// ──────────────────────────────────────────────
// Static Methods
// ──────────────────────────────────────────────

/**
 * Find or create an Artist by name (case-insensitive upsert).
 * Returns the existing or newly created artist document.
 *
 * @param {string} name - Artist display name.
 * @param {Object} [extra] - Optional extra fields to set on creation (imageUrl, artistUrl, etc.).
 * @returns {Promise<Document>}
 */
artistSchema.statics.findOrCreateByName = async function (name, extra = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Artist name is required');
  }

  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  // Try to find existing first (fast path)
  let artist = await this.findOne({ nameLower: lower });
  if (artist) {
    // Update imageUrl / artistUrl if provided and currently missing
    let dirty = false;
    if (extra.imageUrl && !artist.imageUrl) { artist.imageUrl = extra.imageUrl; dirty = true; }
    if (extra.artistUrl && !artist.artistUrl) { artist.artistUrl = extra.artistUrl; dirty = true; }
    if (extra.lastfmMbid && !artist.lastfmMbid) { artist.lastfmMbid = extra.lastfmMbid; dirty = true; }
    if (dirty) await artist.save();
    return artist;
  }

  // Create new
  try {
    artist = await this.create({
      name: trimmed,
      nameLower: lower,
      ...extra,
    });
    return artist;
  } catch (err) {
    // Handle race-condition duplicate key
    if (err.code === 11000) {
      return this.findOne({ nameLower: lower });
    }
    throw err;
  }
};

const Artist = mongoose.model('Artist', artistSchema);

export default Artist;
