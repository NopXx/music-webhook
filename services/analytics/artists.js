import Scrobble from '../../models/Scrobble.js';
import TrackMeta from '../../models/TrackMeta.js';
import Artist from '../../models/Artist.js';
import { resolveArtistImage } from '../artistImageService.js';
import {
  HYDRATE_PIPELINE,
  buildRangeMatch,
  userScope,
  safeLimit,
  ensureTimezone,
  toIsoString,
  normalizeConnectorDocs,
  buildRecentProjection,
  DEFAULT_TIMEZONE
} from './shared.js';

// ──────────────────────────────────────────────
// Top Artists Leaderboard
// ──────────────────────────────────────────────

export const getTopArtistsLeaderboard = async ({
  range = 'all-time',
  offset = 0,
  limit = 10,
  userId = null
} = {}) => {
  const sanitizedLimit = safeLimit(limit, 10, 100);
  const { match: rangeMatch, window } = buildRangeMatch(range, offset);
  const baseMatch = {
    eventType: 'scrobble',
    ...userScope(userId),
    ...(rangeMatch || {})
  };

  const pipeline = [
    { $match: baseMatch },
    ...HYDRATE_PIPELINE,
    { $sort: { scrobbledAt: -1 } },
    {
      $group: {
        _id: '$trackInfo.artist',
        artist: { $first: '$artist' },
        plays: { $sum: 1 },
        lastTrack: {
          $first: {
            title: '$title',
            album: '$album',
            scrobbledAt: '$scrobbledAt',
            connector: '$connector',
            trackArtUrl: '$trackArtUrl',
            animationUrl: '$animationUrl',
            albumUrl: '$albumUrl'
          }
        }
      }
    },
    { $sort: { plays: -1 } },
    { $limit: sanitizedLimit }
  ];

  const results = await Scrobble.aggregate(pipeline);

  return {
    window: {
      ...window,
      start: toIsoString(window.start),
      end: toIsoString(window.end)
    },
    items: results.map((doc) => ({
      artist: doc.artist,
      plays: doc.plays,
      latestTrack: doc.lastTrack,
      artistImage: doc.lastTrack?.trackArtUrl || doc.lastTrack?.animationUrl || null
    }))
  };
};

// ──────────────────────────────────────────────
// Artist Profile
// ──────────────────────────────────────────────

export const getArtistProfileData = async ({
  name,
  tz = DEFAULT_TIMEZONE,
  topLimit = 10,
  recentLimit = 15,
  userId = null
}) => {
  if (!name) {
    throw new Error('artist name is required');
  }

  const timezone = ensureTimezone(tz);
  const timelineStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Find the Artist doc
  const artistDoc = await Artist.findOne({ nameLower: name.trim().toLowerCase() });
  if (!artistDoc) return null;

  // Find all TrackMeta IDs for this artist
  const trackMetaIds = await TrackMeta.find({ artist: artistDoc._id }).distinct('_id');
  if (trackMetaIds.length === 0) return null;

  const baseMatch = {
    eventType: 'scrobble',
    ...userScope(userId),
    track: { $in: trackMetaIds }
  };

  const pipeline = [
    { $match: baseMatch },
    ...HYDRATE_PIPELINE,
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              plays: { $sum: 1 },
              uniqueTracks: {
                $addToSet: '$track'
              },
              uniqueAlbums: {
                $addToSet: '$trackInfo.album'
              },
              firstPlay: { $min: '$scrobbledAt' },
              lastPlay: { $max: '$scrobbledAt' }
            }
          },
          {
            $project: {
              _id: 0,
              totalPlays: '$plays',
              uniqueTracks: { $size: '$uniqueTracks' },
              uniqueAlbums: {
                $size: {
                  $filter: {
                    input: '$uniqueAlbums',
                    cond: { $ne: ['$$this', null] }
                  }
                }
              },
              firstPlay: 1,
              lastPlay: 1
            }
          }
        ],
        topTracks: [
          {
            $group: {
              _id: '$track',
              title: { $first: '$title' },
              album: { $first: '$album' },
              plays: { $sum: 1 },
              lastPlay: { $max: '$scrobbledAt' }
            }
          },
          { $sort: { plays: -1 } },
          { $limit: safeLimit(topLimit, 10, 50) }
        ],
        topAlbums: [
          {
            $match: { 'trackInfo.album': { $ne: null } }
          },
          {
            $group: {
              _id: '$trackInfo.album',
              album: { $first: '$album' },
              plays: { $sum: 1 },
              sampleArt: { $first: '$trackArtUrl' }
            }
          },
          { $sort: { plays: -1 } },
          { $limit: safeLimit(topLimit, 5, 50) }
        ],
        connectors: [
          {
            $group: {
              _id: '$connector',
              plays: { $sum: 1 }
            }
          },
          { $sort: { plays: -1 } }
        ],
        timeline: [
          {
            $match: {
              scrobbledAt: { $gte: timelineStart }
            }
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$scrobbledAt',
                  timezone
                }
              },
              plays: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ],
        recent: [
          { $sort: { scrobbledAt: -1 } },
          { $limit: safeLimit(recentLimit, 15, 50) },
          { $project: buildRecentProjection() }
        ]
      }
    }
  ];

  const [result] = await Scrobble.aggregate(pipeline);
  const overview = result?.overview?.[0];

  if (!overview || overview.totalPlays === 0) {
    return null;
  }

  const latestArt =
    result?.recent?.find((item) => item.trackArtUrl)?.trackArtUrl || null;

  const artistImage = await resolveArtistImage(name, latestArt);

  return {
    overview,
    topTracks: result?.topTracks || [],
    topAlbums: (result?.topAlbums || []).map((a) => ({
      album: a.album,
      plays: a.plays,
      art: a.sampleArt || null
    })),
    connectors: normalizeConnectorDocs(result?.connectors),
    timeline: {
      windowDays: 30,
      data: result?.timeline || []
    },
    recent: result?.recent || [],
    artistImage
  };
};
