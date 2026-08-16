import authService from '../services/authService.js';
import User from '../models/User.js';
import ApiKey from '../models/ApiKey.js';
import { encryptKey, decryptKey } from '../utils/keyCipher.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7d

// ponytail: token is deliberately delivered two ways — the httpOnly cookie
// authenticates browser page navigation (XSS-safe), and the JSON body token
// serves header-based API clients (Bearer). Dropping the body token would break
// non-browser clients; keep both.

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: COOKIE_MAX_AGE,
});

class AuthController {

  async register(req, res) {
    try {
      const { email, password } = req.body || {};

      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Invalid email', message: 'A valid email is required' });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Invalid password', message: 'Password must be at least 8 characters' });
      }

      const existing = await User.findByEmail(email);
      if (existing) {
        return res.status(409).json({ error: 'Conflict', message: 'Email already registered' });
      }

      const passwordHash = await authService.hashPassword(password);
      const user = await User.create({
        email: email.trim().toLowerCase(),
        passwordHash,
        role: 'viewer',
      });

      const token = authService.signToken(user);
      res.cookie('token', token, cookieOptions());
      return res.status(201).json({
        success: true,
        token,
        user: { id: user._id, email: user.email, role: user.role },
      });
    } catch (error) {
      console.error('❌ Register error:', error);
      return res.status(500).json({ error: 'Registration failed', message: error.message });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Missing credentials', message: 'email and password are required' });
      }

      const user = await User.findByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
      }

      const ok = await authService.comparePassword(password, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
      }

      const token = authService.signToken(user);
      res.cookie('token', token, cookieOptions());
      return res.status(200).json({
        success: true,
        token,
        user: { id: user._id, email: user.email, role: user.role },
      });
    } catch (error) {
      console.error('❌ Login error:', error);
      return res.status(500).json({ error: 'Login failed', message: error.message });
    }
  }

  logout(req, res) {
    res.clearCookie('token');
    return res.status(200).json({ success: true, message: 'Logged out' });
  }

  async me(req, res) {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'Not found', message: 'User no longer exists' });
      }
      return res.status(200).json({ user });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to load user', message: error.message });
    }
  }

  // ── API key management ───────────────────────

  async createApiKey(req, res) {
    try {
      const { label } = req.body || {};
      const { raw, hash, prefix } = await authService.generateApiKey();

      const doc = await ApiKey.create({
        keyHash: hash,
        keyEnc: encryptKey(raw),
        prefix,
        label: typeof label === 'string' ? label.trim() : '',
        owner: req.user.id,
      });

      return res.status(201).json({
        success: true,
        message: 'Store this key now — it will not be shown again',
        key: raw,
        apiKey: { id: doc._id, prefix: doc.prefix, label: doc.label, createdAt: doc.createdAt },
      });
    } catch (error) {
      console.error('❌ Create API key error:', error);
      return res.status(500).json({ error: 'Failed to create API key', message: error.message });
    }
  }

  async listApiKeys(req, res) {
    try {
      const keys = await ApiKey.find({ owner: req.user.id, revoked: false }).sort({ createdAt: -1 });
      // Attach the decrypted raw key so the owner can copy the webhook URL anytime.
      // Only keys created after keyEnc was introduced can be recovered; older ones
      // return key: null and stay copy-at-creation-only.
      const apiKeys = keys.map((k) => ({ ...k.toJSON(), key: decryptKey(k.keyEnc) }));
      return res.status(200).json({ apiKeys });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to list API keys', message: error.message });
    }
  }

  async revokeApiKey(req, res) {
    try {
      const { id } = req.params;
      const doc = await ApiKey.findOneAndUpdate(
        { _id: id, owner: req.user.id },
        { $set: { revoked: true } },
        { new: true }
      );
      if (!doc) {
        return res.status(404).json({ error: 'Not found', message: 'API key not found' });
      }
      return res.status(200).json({ success: true, message: 'API key revoked' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to revoke API key', message: error.message });
    }
  }
}

export default new AuthController();
