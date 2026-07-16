import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const apiKeySchema = new mongoose.Schema({
  keyHash: {
    type: String,
    required: true,
  },
  // First 8 chars of the raw key, shown in listings so users can identify a key
  prefix: {
    type: String,
    required: true,
    index: true,
  },
  label: {
    type: String,
    trim: true,
    default: '',
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  lastUsedAt: {
    type: Date,
  },
  revoked: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(_doc, ret) {
      delete ret.keyHash;
      return ret;
    },
  },
});

// ──────────────────────────────────────────────
// Static Methods
// ──────────────────────────────────────────────

/**
 * Verify a raw API key against stored hashes.
 * Matches by prefix first (indexed) then bcrypt-compares the candidates.
 *
 * @param {string} rawKey - The raw API key supplied by the client.
 * @returns {Promise<Document|null>} The matching, non-revoked key doc with `owner` populated, or null.
 */
apiKeySchema.statics.verifyKey = async function (rawKey) {
  if (!rawKey || typeof rawKey !== 'string' || rawKey.length < 8) return null;

  const prefix = rawKey.slice(0, 8);
  const candidates = await this.find({ prefix, revoked: false }).populate('owner');

  for (const candidate of candidates) {
    if (!candidate.owner) continue;
    const match = await bcrypt.compare(rawKey, candidate.keyHash);
    if (match) {
      // Best-effort lastUsedAt update (don't block auth on it)
      candidate.lastUsedAt = new Date();
      candidate.save().catch(() => {});
      return candidate;
    }
  }

  return null;
};

const ApiKey = mongoose.model('ApiKey', apiKeySchema);

export default ApiKey;
