// Reversible encryption for API keys so the owner can retrieve the full key
// (and its webhook URL) anytime — not just at creation. Uses AES-256-GCM with a
// key derived from JWT_SECRET (or API_KEY_ENC_SECRET). If no secret is set,
// ciphering is disabled and callers fall back to show-once behavior.
//
// ponytail: sha256(secret) as the AES key, no rotation. Set API_KEY_ENC_SECRET
// and re-key if you ever need rotation.
import crypto from 'crypto';

const secret = process.env.API_KEY_ENC_SECRET || process.env.JWT_SECRET || '';
const KEY = secret ? crypto.createHash('sha256').update(secret).digest() : null;

export const canCipher = () => KEY !== null;

export const encryptKey = (text) => {
  if (!KEY || !text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64')).join('.');
};

export const decryptKey = (blob) => {
  if (!KEY || !blob) return null;
  try {
    const [iv, tag, ct] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

// tiny self-check: bun -e 'import("./utils/keyCipher.js").then(m=>{const e=m.encryptKey("abc");console.assert(m.decryptKey(e)==="abc","roundtrip");console.log("ok")})'
