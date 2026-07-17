import { describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { refName } from '../services/scrobbleService.js';

// enrichWithSpotifyData/enrichWithAnimationData resolve artist+album names through
// refName. It returned '' for every scrobble once the schema went normalized, so
// every Spotify search ran as artist:"" and matched nothing.
describe('refName', () => {
  test('reads the name off a populated ref', () => {
    expect(refName({ name: 'The Weeknd' })).toBe('The Weeknd');
  });

  test('passes through a plain string (legacy flat shape)', () => {
    expect(refName('The Weeknd')).toBe('The Weeknd');
  });

  // The bug that mattered: an ObjectId is truthy, so a bare `|| value` fallback
  // hands its hex string to Spotify as the artist name.
  test('yields empty for an unpopulated ObjectId ref', () => {
    expect(refName(new mongoose.Types.ObjectId())).toBe('');
  });

  test('yields empty for missing values', () => {
    for (const value of [null, undefined, {}]) expect(refName(value)).toBe('');
  });
});
