import { describe, it, expect, afterEach, setSystemTime } from 'bun:test';
import nowPlayingService from '../services/nowPlayingService.js';

// "Has the song ended?" must follow the player's position, not the wall clock
// since the song started: pauses, ads and buffering push the wall clock past the
// song's length while the song is still playing.
const T0 = new Date('2026-10-24T12:00:00Z').getTime();
const at = (s) => setSystemTime(new Date(T0 + s * 1000));
const song = { title: 'Song', artist: 'Band', duration: 200, connector: 'youtube', startTimestamp: T0 };
let n = 0;
const user = () => `np-test-${++n}`;

afterEach(() => setSystemTime());

describe('now playing end of song', () => {
  it('keeps playing after a pause until the position reaches the end', () => {
    const u = user();
    at(0);
    nowPlayingService.updateFromEvent(u, { ...song, eventType: 'nowplaying', currentTime: 0 });
    at(60);
    nowPlayingService.updateFromEvent(u, { ...song, eventType: 'paused', currentTime: 60 });
    at(120);
    nowPlayingService.updateFromEvent(u, { ...song, eventType: 'resumedplaying', currentTime: 60 });

    at(230); // 230s since start, but only 170s into the song
    const status = nowPlayingService.getStatus(u);
    expect(status.playing).toBe(true);
    expect(status.progress).toBe(170);
  });

  it('ends once the position passes the length', () => {
    const u = user();
    at(0);
    nowPlayingService.updateFromEvent(u, { ...song, eventType: 'nowplaying', currentTime: 0 });
    at(216);
    expect(nowPlayingService.getStatus(u).playing).toBe(false);
  });

  it('allows a few seconds past the reported length before ending', () => {
    const u = user();
    at(0);
    nowPlayingService.updateFromEvent(u, { ...song, eventType: 'nowplaying' });
    at(205);
    expect(nowPlayingService.getStatus(u).playing).toBe(true);
  });
});
