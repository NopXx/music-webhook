import Scrobble from '../../models/Scrobble.js';
import TrackMeta from '../../models/TrackMeta.js';
import Artist from '../../models/Artist.js';
import Album from '../../models/Album.js';
import {
  HYDRATE_PIPELINE,
  userScope,
  safeLimit,
  ensureTimezone,
  normalizeConnectorDocs,
  buildRecentProjection,
  DEFAULT_TIMEZONE
} from './shared.js';

// ──────────────────────────────────────────────
// Album Insights
// ──────────────────────────────────────────────

export const getAlbumInsights = async ({
  artist,
  album,
  recentLimit = 12,
  timezone = DEFAULT_TIMEZONE,
  userId = null
}) => {
  if (!artist || !album) {
    throw new Error('artist and album are required');
  }

  const tz = ensureTimezone(timezone);
  const timelineStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Look up Artist + Album docs
  const artistDoc = await Artist.findOne({ nameLower: artist.trim().toLowerCase() });
  if (!artistDoc) return null;

  const albumDoc = await Album.findOne({
    nameLower: album.trim().toLowerCase(),
    artist: artistDoc._id
  });
  if (!albumDoc) return null;

  // Find all TrackMeta IDs for this album
  const trackMetaIds = await TrackMeta.find({ album: albumDoc._id }).distinct('_id');
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
              firstPlay: { $min: '$scrobbledAt' },
              lastPlay: { $max: '$scrobbledAt' },
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
        tracks: [
          {
            $group: {
              _id: '$track',
              title: { $first: '$title' },
              plays: { $sum: 1 },
              avgDuration: { $avg: '$duration' }
            }
          },
          { $sort: { plays: -1 } }
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
                  timezone: tz
                }
              },
              plays: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ],
        recent: [
          { $sort: { scrobbledAt: -1 } },
          { $limit: safeLimit(recentLimit, 12, 50) },
          { $project: buildRecentProjection() }
        ]
      }
    }
  ];

  const [result] = await Scrobble.aggregate(pipeline);
  const overview = result?.overview?.[0];

  if (!overview || overview.plays === 0) {
    return null;
  }

  return {
    meta: {
      artist: artist,
      album: album,
      trackArtUrl: albumDoc.trackArtUrl || result?.recent?.[0]?.trackArtUrl || null,
      animationUrl: result?.recent?.[0]?.animationUrl || null,
      appleMusicUrl: albumDoc.appleMusicUrl || null
    },
    overview: {
      totalScrobbles: overview.plays,
      firstPlay: overview.firstPlay,
      lastPlay: overview.lastPlay,
      averageDurationSeconds: Math.round(overview.avgDuration || 0)
    },
    tracks: (result?.tracks || []).map((doc) => ({
      title: doc.title,
      plays: doc.plays,
      averageDurationSeconds: doc.avgDuration ? Math.round(doc.avgDuration) : null
    })),
    connectors: normalizeConnectorDocs(result?.connectors),
    timeline: result?.timeline || [],
    recent: result?.recent || [],
    coverArt:
      albumDoc.trackArtUrl ||
      result?.recent?.[0]?.trackArtUrl ||
      result?.recent?.[0]?.albumUrl ||
      null
  };
};
