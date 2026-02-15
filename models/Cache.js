
import mongoose from 'mongoose';

const cacheSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index: documents will be automatically deleted after this time
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create a compound index if we want to search by other fields later, but key is primary
// cacheSchema.index({ key: 1 }); // Already indexed by unique: true

const Cache = mongoose.model('Cache', cacheSchema);

export default Cache;
