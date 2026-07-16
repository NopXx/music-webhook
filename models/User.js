import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['admin', 'viewer'],
    default: 'viewer',
  },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(_doc, ret) {
      delete ret.passwordHash;
      return ret;
    },
  },
});

// ──────────────────────────────────────────────
// Static Methods
// ──────────────────────────────────────────────

userSchema.statics.findByEmail = function (email) {
  if (!email || typeof email !== 'string') return null;
  return this.findOne({ email: email.trim().toLowerCase() });
};

const User = mongoose.model('User', userSchema);

export default User;
