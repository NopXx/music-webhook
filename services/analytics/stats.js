import Scrobble from '../../models/Scrobble.js';
import {
  HYDRATE_PIPELINE,
  buildRangeMatch,
  userScope,
  toIsoString,
  normalizeConnectorDocs,
  buildRecentProjection,
  withAnalyticsCache,
  analyticsCacheKey,
  CACHE_TTL
} from './shared.js';

// ──────────────────────────────────────────────
// Stats Overview
// ──────────────────────────────────────────────

const computeStatsOverview = async ({
  range = 'all-time',
  offset = 0,
  recentLimit = 10,
  topArtistLimit = 5,
  userId = null
} = {}) => {
  const { match: rangeMatch, window } = buildRangeMatch(range, offset);
  const baseMatch = {
    eventType: 'scrobble',
    ...userScope(userId),
    ...(rangeMatch || {})
  };

  const pipeline = [
    { $match: baseMatch },
    ...HYDRATE_PIPELINE,
    {
      $facet: {
        plays: [
          {
            $group: {
              _id: null,
              totalPlays: { $sum: 1 },
              totalDuration: {
                $sum: {
                  $cond: [
                    { $and: [{ $ifNull: ['$duration', false] }, { $gt: ['$duration', 0] }] },
                    '$duration',
                    0
                  ]
                }
              },
              avgDuration: {
                $avg: {
                  $cond: [
                    { $and: [{ $ifNull: ['$duration', false] }, { $gt: ['$duration', 0] }] },
                    '$duration',
                    null
                  ]
                }
              }
            }
          }
        ],
        uniqueTracks: [
          {
            $group: {
              _id: '$track'
            }
          },
          { $count: 'count' }
        ],
        uniqueArtists: [
          {
            $group: {
              _id: '$trackInfo.artist'
            }
          },
          { $count: 'count' }
        ],
        connectors: [
          {
            $match: {
              connector: { $exists: true, $ne: null }
            }
          },
          {
            $group: {
              _id: '$connector',
              plays: { $sum: 1 }
            }
          },
          { $sort: { plays: -1 } },
          { $limit: 5 }
        ],
        recent: [
          { $sort: { scrobbledAt: -1 } },
          { $limit: Math.max(1, recentLimit) },
          { $project: buildRecentProjection() }
        ],
        topArtists: [
          { $sort: { scrobbledAt: -1 } },
          {
            $group: {
              _id: '$trackInfo.artist',
              artist: { $first: '$artist' },
              plays: { $sum: 1 },
              lastScrobble: { $first: '$scrobbledAt' }
            }
          },
          { $sort: { plays: -1 } },
          { $limit: Math.max(1, topArtistLimit) }
        ]
      }
    }
  ];

  const [result] = await Scrobble.aggregate(pipeline);
  const overview = result?.plays?.[0] || {};
  const totals = {
    totalPlays: overview.totalPlays || 0,
    uniqueTracks: result?.uniqueTracks?.[0]?.count || 0,
    uniqueArtists: result?.uniqueArtists?.[0]?.count || 0,
    totalDurationSeconds: overview.totalDuration || 0,
    averageDurationSeconds: Math.round(overview.avgDuration || 0)
  };

  return {
    totals,
    connectors: normalizeConnectorDocs(result?.connectors),
    recent: result?.recent || [],
    topArtists: (result?.topArtists || []).map((a) => ({
      artist: a.artist,
      plays: a.plays,
      lastScrobbledAt: a.lastScrobble
    })),
    window: {
      ...window,
      start: toIsoString(window.start),
      end: toIsoString(window.end)
    }
  };
};

export const getStatsOverview = (args = {}) =>
  withAnalyticsCache(
    analyticsCacheKey('stats', args.userId, [
      args.range, args.offset, args.recentLimit, args.topArtistLimit
    ]),
    CACHE_TTL.stats,
    () => computeStatsOverview(args)
  );
