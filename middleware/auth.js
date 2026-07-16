import authService from '../services/authService.js';
import ApiKey from '../models/ApiKey.js';
import User from '../models/User.js';

/**
 * Extract a JWT from the Authorization header (Bearer) or the `token` cookie.
 */
const extractToken = (req) => {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return null;
};

/**
 * Resolve req.user from a JWT. Returns the decoded payload-derived user, or null.
 */
const userFromToken = (req) => {
  const token = extractToken(req);
  if (!token) return null;
  try {
    const decoded = authService.verifyToken(token);
    return { id: decoded.sub, email: decoded.email, role: decoded.role };
  } catch {
    return null;
  }
};

/**
 * Require a valid JWT. Sets req.user. Responds 401 JSON on failure.
 */
export const authenticate = (req, res, next) => {
  const user = userFromToken(req);
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid authentication token required',
    });
  }
  req.user = user;
  next();
};

/**
 * Like authenticate, but redirects to /login on failure (for HTML pages).
 */
export const authenticatePage = (req, res, next) => {
  const user = userFromToken(req);
  if (!user) {
    return res.redirect(302, '/login');
  }
  req.user = user;
  next();
};

/**
 * Require req.user.role to be one of the allowed roles. Use after authenticate.
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Requires role: ${roles.join(' or ')}`,
    });
  }
  next();
};

// Resolve which user the legacy global API_KEY scrobbles as.
//
// Set API_KEY_OWNER_EMAIL to name that account explicitly. Without it we fall
// back to the oldest admin, which is a guess: if a newer account holds the real
// listening history, scrobbles silently land on the wrong user and the history
// splits in two. If the configured email doesn't exist we fail closed (401)
// rather than quietly picking someone else.
//
// Memoized — the mapping is stable, so this runs once per process instead of
// once per webhook request. Safe across warm serverless invocations.
let legacyOwnerCache = null;
const resolveLegacyOwner = async () => {
  if (legacyOwnerCache) return legacyOwnerCache;

  const configuredEmail = process.env.API_KEY_OWNER_EMAIL?.trim().toLowerCase();
  const owner = configuredEmail
    ? await User.findOne({ email: configuredEmail })
    : await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });

  if (!owner) {
    if (configuredEmail) {
      console.error(`❌ API_KEY_OWNER_EMAIL="${configuredEmail}" matches no user — legacy API key rejected`);
    }
    return null;
  }

  legacyOwnerCache = { id: String(owner._id), email: owner.email, role: owner.role };
  return legacyOwnerCache;
};

/**
 * Authenticate scrobbler clients: accept an API key (x-api-key header) or a JWT.
 * Sets req.user to the key owner / token user. Used for webhook + now-playing intake.
 *
 * API key resolution order:
 *   1. Legacy global API_KEY env → maps to API_KEY_OWNER_EMAIL (or oldest admin)
 *   2. Per-user ApiKey lookup (ApiKey.verifyKey)
 *   3. JWT fallback (Bearer / cookie)
 */
export const authenticateClient = async (req, res, next) => {
  // Header is preferred. Fall back to a query param for clients that can't set
  // headers (e.g. Web Scrobbler's webhook only lets you configure a URL).
  const queryKey = req.query.api_key || req.query.apikey;
  const rawKey = req.headers['x-api-key'] || (typeof queryKey === 'string' ? queryKey : undefined);

  if (rawKey) {
    // 1. Legacy global key → its configured owner (memoized, see resolveLegacyOwner)
    if (process.env.API_KEY && rawKey === process.env.API_KEY) {
      const owner = await resolveLegacyOwner();
      if (owner) {
        req.user = { ...owner };
        return next();
      }
    }

    // 2. Per-user API key
    const keyDoc = await ApiKey.verifyKey(rawKey);
    if (keyDoc && keyDoc.owner) {
      req.user = {
        id: String(keyDoc.owner._id),
        email: keyDoc.owner.email,
        role: keyDoc.owner.role,
      };
      return next();
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
  }

  // 3. JWT fallback
  const user = userFromToken(req);
  if (user) {
    req.user = user;
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'API key (x-api-key header or ?api_key= query) or bearer token required',
  });
};

export default {
  authenticate,
  authenticatePage,
  requireRole,
  authenticateClient,
};
