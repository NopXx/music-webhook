import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import express from 'express';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-playerinternal';

import playerRouter from '../routes/player.js';
import nowPlayingService from '../services/nowPlayingService.js';

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('GET /api/nowplaying/internal', () => {
  const original = process.env.INTERNAL_TOKEN;
  let server;
  let base;

  beforeEach(() => {
    process.env.INTERNAL_TOKEN = 'internal-test-token';
    const app = express();
    app.use(playerRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => {
    server.close();
    nowPlayingService.users.clear();
    if (original === undefined) delete process.env.INTERNAL_TOKEN;
    else process.env.INTERNAL_TOKEN = original;
  });

  const get = (query, headers = {}) => fetch(`${base}/api/nowplaying/internal${query}`, { headers });
  const auth = { 'X-Internal-Token': 'internal-test-token' };

  it('returns 404 when INTERNAL_TOKEN is unset, even with a header', async () => {
    delete process.env.INTERNAL_TOKEN;
    const res = await get(`?userId=${USER}`, auth);
    expect(res.status).toBe(404);
  });

  it('rejects a missing or wrong token with 401', async () => {
    expect((await get(`?userId=${USER}`)).status).toBe(401);
    expect((await get(`?userId=${USER}`, { 'X-Internal-Token': 'nope' })).status).toBe(401);
    expect((await get(`?userId=${USER}`, { 'X-Internal-Token': 'internal-test-token-but-longer' })).status).toBe(401);
  });

  it('requires userId (400)', async () => {
    expect((await get('', auth)).status).toBe(400);
  });

  it('returns the slim idle shape for a user with nothing playing', async () => {
    const res = await get(`?userId=${USER}`, auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ playing: false, status: 'unknown', updatedAt: null, track: null });
  });

  it("returns that user's track, not another user's", async () => {
    nowPlayingService.setPlaying(USER, { title: 'Song A', artist: 'Artist A', duration: 300, connector: 'test' });
    nowPlayingService.setPlaying(OTHER, { title: 'Song B', artist: 'Artist B', duration: 300, connector: 'test' });

    const res = await get(`?userId=${USER}`, auth);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.playing).toBe(true);
    expect(data.status).toBe('playing');
    expect(data.track.title).toBe('Song A');
    expect(data.track.artist).toBe('Artist A');
  });

  it('supports ETag / 304', async () => {
    nowPlayingService.setPlaying(USER, { title: 'Song A', artist: 'Artist A', duration: 300, connector: 'test' });

    const first = await get(`?userId=${USER}`, auth);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"np-\d+"$/);

    const second = await get(`?userId=${USER}`, { ...auth, 'If-None-Match': etag });
    expect(second.status).toBe(304);
  });
});
