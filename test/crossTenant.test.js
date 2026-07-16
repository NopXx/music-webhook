// Verifies per-user data isolation is fail-closed: a bad/foreign userId must
// return NOTHING, never another user's scrobbles. Guards against userScope
// regressing to the old fail-open `{}` (which leaked all users' data).
//
// Tests the production userScope primitive directly (utils/objectId.js) plus a
// real Scrobble query. It deliberately does NOT go through analyticsService,
// which sibling test files mock.module — that mock leaks across bun's shared
// module registry and would poison an analyticsService-based assertion here.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Scrobble from '../models/Scrobble.js';
import { userScope, NEVER_MATCH_ID } from '../utils/objectId.js';

dotenv.config();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/music-webhook-test';

const userA = new mongoose.Types.ObjectId();
const userB = new mongoose.Types.ObjectId();

describe('userScope fail-closed shape', () => {
  it('valid id scopes to that user', () => {
    expect(String(userScope(userA).user)).toBe(String(userA));
  });
  it('invalid id scopes to the never-match sentinel, not {}', () => {
    expect(String(userScope('not-an-objectid').user)).toBe(String(NEVER_MATCH_ID));
  });
  it('null id scopes to the never-match sentinel, not {}', () => {
    expect(String(userScope(null).user)).toBe(String(NEVER_MATCH_ID));
  });
});

describe('cross-tenant isolation (real query)', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI);
    await Scrobble.findOrCreateScrobble({
      eventType: 'scrobble',
      artist: 'XT Isolation Artist',
      title: 'XT Isolation Track',
      album: 'XT Isolation Album',
      user: userA,
    });
  });

  afterAll(async () => {
    await Scrobble.deleteMany({ user: { $in: [userA, userB] } });
    await mongoose.disconnect();
  });

  const count = (userId) => Scrobble.countDocuments(userScope(userId));

  it('owner sees their own scrobble', async () => {
    expect(await count(userA)).toBeGreaterThanOrEqual(1);
  });
  it('a different user sees nothing', async () => {
    expect(await count(userB)).toBe(0);
  });
  it('an invalid userId sees nothing (fail-closed)', async () => {
    expect(await count('not-an-objectid')).toBe(0);
  });
  it('a null userId sees nothing (fail-closed)', async () => {
    expect(await count(null)).toBe(0);
  });
});
