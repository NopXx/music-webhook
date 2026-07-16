import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const SALT_ROUNDS = 10;
const DEFAULT_EXPIRES_IN = '7d';

class AuthService {
  get jwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET is required in production');
      }
      // Dev fallback — warn loudly so it's obvious tokens won't survive a restart
      console.warn('⚠️ JWT_SECRET not set — using insecure dev fallback');
      return 'dev-insecure-secret-change-me';
    }
    return secret;
  }

  // ── Passwords ────────────────────────────────
  hashPassword(plain) {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  comparePassword(plain, hash) {
    return bcrypt.compare(plain, hash);
  }

  // ── JWT ──────────────────────────────────────
  signToken(user) {
    const payload = {
      sub: String(user._id || user.id),
      email: user.email,
      role: user.role,
    };
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
    });
  }

  verifyToken(token) {
    return jwt.verify(token, this.jwtSecret);
  }

  // ── API keys ─────────────────────────────────
  /**
   * Generate a new raw API key plus its bcrypt hash and lookup prefix.
   * Only the hash + prefix are stored; the raw key is shown to the user once.
   */
  async generateApiKey() {
    const raw = crypto.randomBytes(24).toString('hex'); // 48 hex chars
    const hash = await bcrypt.hash(raw, SALT_ROUNDS);
    const prefix = raw.slice(0, 8);
    return { raw, hash, prefix };
  }

  // ── Admin seeding ────────────────────────────
  /**
   * Create the seed admin from ADMIN_EMAIL / ADMIN_PASSWORD if it doesn't exist.
   * Idempotent — safe to call on every boot / cold start.
   * @returns {Promise<Document|null>} The admin user (existing or created), or null if not configured.
   */
  async seedAdmin() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      return null;
    }

    const existing = await User.findByEmail(email);
    if (existing) {
      return existing;
    }

    const passwordHash = await this.hashPassword(password);
    const admin = await User.create({
      email: email.trim().toLowerCase(),
      passwordHash,
      role: 'admin',
    });
    console.log(`👤 Seeded admin user: ${admin.email}`);
    return admin;
  }
}

export default new AuthService();
