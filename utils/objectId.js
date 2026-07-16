import mongoose from 'mongoose';

// Aggregation $match does not auto-cast strings to ObjectId — do it explicitly.
export const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; }
};

// A syntactically-valid ObjectId that never matches a real document. Used as a
// fail-closed sentinel so a missing/invalid user id yields an empty result set
// instead of matching everything (cross-tenant leak).
export const NEVER_MATCH_ID = new mongoose.Types.ObjectId('000000000000000000000000');

// Build the per-user scope fragment merged into every Scrobble $match/query.
// Fail-closed: a missing/invalid userId scopes to a sentinel that matches no
// document, so a bad id returns nothing rather than every user's data.
export const userScope = (userId) => ({ user: toObjectId(userId) || NEVER_MATCH_ID });
