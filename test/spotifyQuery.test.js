import { describe, expect, test } from 'bun:test';

// No mock.module here on purpose: the point is to cast against the REAL schema.
// This is the check that fails if the query drifts away from trackMetaSchema again.
import TrackMeta from '../models/TrackMeta.js';
import '../models/Artist.js';
import { buildMissingDataQuery } from '../controllers/spotifyController.js';

const CASES = [
  ['force', { forceUpdate: true }],
  ['no spotify data', { onlyMissingBasicData: false }],
  ['missing only, default priority', { onlyMissingBasicData: true, priorityFields: 'duration,album,trackNumber' }],
  ['missing only, album priority', { onlyMissingBasicData: true, priorityFields: 'album' }],
  ['missing only, unknown priority', { onlyMissingBasicData: true, priorityFields: 'year,bogus' }],
  ['missing only, empty priority', { onlyMissingBasicData: true, priorityFields: '' }],
];

// ponytail: bun's mock.module is global, so spotifyController.test.js mocking
// TrackMeta leaks into this file and swaps the real model out from under us.
// The cast check needs the real schema, so it only runs when it got one — i.e.
// under `bun test test/spotifyQuery.test.js`, not the whole-suite run.
// Upgrade path: narrow that file's mock, then drop this guard.
const hasRealSchema = typeof TrackMeta?.schema?.path === 'function';

describe('buildMissingDataQuery', () => {
  // Casting is what threw `Cast to ObjectId failed for value "" at path "album"`.
  test.skipIf(!hasRealSchema)('every query shape casts against trackMetaSchema', () => {
    for (const [name, opts] of CASES) {
      const query = buildMissingDataQuery(opts);
      expect(() => TrackMeta.find(query).cast(TrackMeta), name).not.toThrow();
    }
  });

  test('unknown priority fields fall back to the enrichable set', () => {
    const query = buildMissingDataQuery({ onlyMissingBasicData: true, priorityFields: 'year,bogus' });
    expect(query.$and[0].$or).toEqual([{ duration: null }, { album: null }, { trackNumber: null }]);
  });

  test('album is matched by null, never by empty string', () => {
    const query = buildMissingDataQuery({ onlyMissingBasicData: true, priorityFields: 'album' });
    expect(query.$and[0].$or).toEqual([{ album: null }]);
  });

  test('force matches everything', () => {
    expect(buildMissingDataQuery({ forceUpdate: true })).toEqual({});
  });
});
