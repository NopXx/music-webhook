// Shared auth helpers for the HTTP integration scripts in this directory.
//
// Two auth paths exist server-side (see middleware/auth.js):
//   - authenticateClient  → accepts the legacy global API_KEY via `x-api-key`.
//     Used by /webhook* and POST /api/nowplaying/playing.  → apiKeyHeaders()
//   - authenticate        → JWT only (Bearer header or `token` cookie).
//     Used by the /api/* reads and admin endpoints.        → await bearerHeaders()
import { config } from 'dotenv';

config();

const BASE_URL = process.env.BASE_URL || process.env.WEBHOOK_URL || 'http://localhost:3000';

/**
 * Headers for endpoints behind `authenticateClient` (webhook + now-playing intake).
 */
export function apiKeyHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.API_KEY,
    ...extra,
  };
}

let tokenPromise = null;

/**
 * Log in as the seeded admin and return the JWT. Memoized per process.
 */
export async function getToken() {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.ADMIN_EMAIL,
          password: process.env.ADMIN_PASSWORD,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        throw new Error(
          `Login failed (${response.status}): ${data.message || data.error || 'no token in response'}. ` +
          'Check ADMIN_EMAIL / ADMIN_PASSWORD in .env'
        );
      }
      return data.token;
    })().catch((error) => {
      tokenPromise = null; // allow a retry on the next call
      throw error;
    });
  }
  return tokenPromise;
}

/**
 * Headers for endpoints behind `authenticate` (JWT-only /api/* reads + admin).
 */
export async function bearerHeaders(extra = {}) {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

export default { apiKeyHeaders, bearerHeaders, getToken };
