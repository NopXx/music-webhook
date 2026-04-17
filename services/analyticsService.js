import Scrobble from '../models/Scrobble.js';
import TrackMeta from '../models/TrackMeta.js';
import Artist from '../models/Artist.js';
import Album from '../models/Album.js';
import { resolveArtistImage } from './artistImageService.js';

const RANGE_CONFIG = {
  week: { ms: 7 * 24 * 60 * 60 * 1000 },
  month: { months: 1 },
  year: { years: 1 },
  'all-time': null
};

const DEFAULT_TIMEZONE = 'UTC';
const MAX_TRACK_LIMIT = 200;
const DEFAULT_TRACK_LIMIT = 50;

const SORTABLE_TRACK_FIELDS = new Set([
  'scrobbledAt',
  'timestamp',
  'createdAt',
  'updatedAt',
  'duration',
  'artist',
  'title',
  'album',
  'connector',
  'source'
]);

const WEEKDAY_LABELS = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun'
};

const sanitizeRange = (range = 'all-time') => {
  if (typeof range !== 'string') return 'all-time';
  const normalized = range.toLowerCase();
  return RANGE_CONFIG[normalized] ? normalized : 'all-time';
};

const sanitizeOffset = (offset = 0) => {
  const value = Number(offset);
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
};

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

const subtractWindow = (date, config, multiplier = 1) => {
  const result = new Date(date);
  if (config?.ms) {
    result.setTime(result.getTime() - config.ms * multiplier);
    return result;
  }
  if (config?.months) {
    result.setMonth(result.getMonth() - config.months * multiplier);
    return result;
  }
  if (config?.years) {
    result.setFullYear(result.getFullYear() - config.years * multiplier);
    return result;
  }
  return result;
};

export const resolveRangeWindow = (range = 'all-time', offset = 0) => {
  const normalizedRange = sanitizeRange(range);
  const normalizedOffset = sanitizeOffset(offset);

  if (normalizedRange === 'all-time') {
    return {
      range: normalizedRange,
      offset: normalizedOffset,
      start: null,
      end: null
    };
  }

  const config = RANGE_CONFIG[normalizedRange];
  const now = new Date();
  const end = normalizedOffset > 0
    ? subtractWindow(now, config, normalizedOffset)
    : now;
  const start = subtractWindow(end, config, 1);

  return {
    range: normalizedRange,
    offset: normalizedOffset,
    start,
    end
  };
};

const buildRangeMatch = (range, offset, field = 'scrobbledAt') => {
  const window = resolveRangeWindow(range, offset);
  if (!window.start || !window.end) {
    return { match: {}, window };
  }
  return {
    match: {
      [field]: {
        $gte: window.start,
        $lte: window.end
      }
    },
    window
  };
};

const safeLimit = (limit, fallback = DEFAULT_TRACK_LIMIT, max = MAX_TRACK_LIMIT) => {
  const value = Number(limit);
  if (Number.isFinite(value) && value > 0) {
    return clampNumber(Math.floor(value), 1, max);
  }
  return fallback;
};

const safePage = (page) => {
  const value = Number(page);
  if (Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return 1;
};

const safeSortField = (field) => {
  if (typeof field !== 'string') return 'scrobbledAt';
  return SORTABLE_TRACK_FIELDS.has(field) ? field : 'scrobbledAt';
};

const safeSortOrder = (order) => {
  if (typeof order !== 'string') return -1;
  const normalized = order.toLowerCase();
  return normalized === 'asc' ? 1 : -1;
};

const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const buildExactRegex = (value) => {
  return new RegExp(`^${escapeRegex(value)}$`, 'i');
};

const ensureTimezone = (tz) => {
  if (!tz || typeof tz !== 'string') {
    return DEFAULT_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch (error) {
    return DEFAULT_TIMEZONE;
  }
};

const toIsoString = (date) => (date ? date.toISOString() : null);

const fillHourlyBuckets = (items = []) => {
  const byHour = new Map(items.map((item) => [item._id, item.plays]));
  return Array.from({ length: 24 }).map((_, hour) => ({
    hour,
    plays: byHour.get(hour) || 0
  }));
};

const fillDailyBuckets = (items = []) => {
  const byDay = new Map(items.map((item) => [item._id, item.plays]));
  return Array.from({ length: 7 }).map((_, idx) => {
    const day = idx + 1;
    return {
      day,
      label: WEEKDAY_LABELS[day],
      plays: byDay.get(day) || 0
    };
  });
};

const normalizeConnectorDocs = (docs = []) => {
  return docs
    .filter((doc) => doc && doc._id)
    .map((doc) => ({
      connector: doc._id,
      plays: doc.plays
    }));
};

const normalizeSourceDocs = (docs = []) => {
  return docs
    .filter((doc) => doc && doc._id)
    .map((doc) => ({
      source: doc._id,
      plays: doc.plays
    }));
};

// ──────────────────────────────────────────────
// Common $lookup stages to hydrate Scrobble docs
// ──────────────────────────────────────────────

const HYDRATE_PIPELINE = [
  {
    $lookup: {
      from: 'trackmetas',
      localField: 'track',
      foreignField: '_id',
      as: 'trackInfo'
    }
  },
  { $unwind: '$trackInfo' },
  {
    $lookup: {
      from: 'artists',
      localField: 'trackInfo.artist',
      foreignField: '_id',
      as: 'artistInfo'
    }
  },
  { $unwind: '$artistInfo' },
  {
    $lookup: {
      from: 'albums',
      localField: 'trackInfo.album',
      foreignField: '_id',
      as: 'albumInfo'
    }
  },
  {
    $unwind: {
      path: '$albumInfo',
      preserveNullAndEmptyArrays: true
    }
  },
  {
    $addFields: {
      artist: '$artistInfo.name',
      title: '$trackInfo.title',
      album: { $ifNull: ['$albumInfo.name', ''] },
      duration: '$trackInfo.duration',
      trackArtUrl: '$trackInfo.trackArtUrl',
      animationUrl: '$trackInfo.animationUrl',
      albumUrl: { $ifNull: ['$albumInfo.albumUrl', ''] },
      appleMusicUrl: '$trackInfo.appleMusicUrl',
      spotify_enriched: '$trackInfo.spotify_enriched',
    }
  }
];

const buildRecentProjection = () => ({
  title: 1,
  artist: 1,
  album: 1,
  scrobbledAt: 1,
  connector: 1,
  source: 1,
  duration: 1,
  trackArtUrl: 1,
  animationUrl: 1,
  albumUrl: 1,
  metadataLabel: 1,
  isLoved: 1,
  spotify_enriched: 1
});

// ──────────────────────────────────────────────
// Stats Overview
// ──────────────────────────────────────────────

export const getStatsOverview = async ({
  range = 'all-time',
  offset = 0,
  recentLimit = 10,
  topArtistLimit = 5
} = {}) => {
  const { match: rangeMatch, window } = buildRangeMatch(range, offset);
  const baseMatch = {
    eventType: 'scrobble',
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

// ──────────────────────────────────────────────
// Tracks Listing (paginated)
// ──────────────────────────────────────────────

export const getTracksListing = async ({
  page,
  limit,
  offset,
  sortBy,
  order,
  search,
  connector,
  source,
  range = 'all-time',
  rangeOffset = 0
} = {}) => {
  const sanitizedLimit = safeLimit(limit);
  const sanitizedPage = safePage(page);
  const sanitizedOrder = safeSortOrder(order);
  const sanitizedSortField = safeSortField(sortBy);
  const skip = offset
    ? Math.max(0, Number(offset))
    : (sanitizedPage - 1) * sanitizedLimit;

  const { match: rangeMatch, window } = buildRangeMatch(range, rangeOffset);

  const scrobbleMatch = {
    eventType: 'scrobble',
    ...(rangeMatch || {})
  };
  if (connector) scrobbleMatch.connector = connector;
  if (source) scrobbleMatch.source = source;

  // Build aggregation pipeline
  const pipeline = [
    { $match: scrobbleMatch },
    ...HYDRATE_PIPELINE,
  ];

  // If there is a search query, filter after hydration
  if (search && typeof search === 'string') {
    const keywords = search.trim();
    if (keywords.length > 0) {
      const regex = new RegExp(keywords.replace(/\s+/g, '.*'), 'i');
      pipeline.push({
        $match: {
          $or: [
            { title: regex },
            { artist: regex },
            { album: regex }
          ]
        }
      });
    }
  }

  // Count total after filtering
  const countPipeline = [...pipeline, { $count: 'total' }];
  const [countResult] = await Scrobble.aggregate(countPipeline);
  const total = countResult?.total || 0;

  // Retrieve page
  pipeline.push(
    { $sort: { [sanitizedSortField]: sanitizedOrder } },
    { $skip: skip },
    { $limit: sanitizedLimit }
  );

  const tracks = await Scrobble.aggregate(pipeline);

  // Calculate userPlayCount per track
  const tracksWithPlayCount = await Promise.all(
    tracks.map(async (scrobble) => {
      const playCount = await Scrobble.countDocuments({
        eventType: 'scrobble',
        track: scrobble.track
      });
      return {
        ...scrobble,
        userPlayCount: playCount
      };
    })
  );

  const effectivePage = offset
    ? Math.floor(skip / sanitizedLimit) + 1
    : sanitizedPage;

  return {
    tracks: tracksWithPlayCount,
    pagination: {
      page: effectivePage,
      limit: sanitizedLimit,
      total,
      totalPages: Math.ceil(total / sanitizedLimit) || 1,
      hasNextPage: skip + sanitizedLimit < total,
      hasPreviousPage: skip > 0
    },
    sort: {
      by: sanitizedSortField,
      order: sanitizedOrder === 1 ? 'asc' : 'desc'
    },
    filters: {
      search: search || null,
      connector: connector || null,
      source: source || null,
      range: range || 'all-time',
      rangeOffset: rangeOffset || 0
    },
    window: {
      ...window,
      start: toIsoString(window.start),
      end: toIsoString(window.end)
    }
  };
};

// ──────────────────────────────────────────────
// Update Loved Status
// ──────────────────────────────────────────────

export const updateLovedTrackStatus = async ({ id, isLoved }) => {
  if (!id) {
    throw new Error('Track id is required');
  }
  if (typeof isLoved !== 'boolean') {
    throw new Error('isLoved must be a boolean value');
  }

  const scrobble = await Scrobble.findByIdAndUpdate(
    id,
    { $set: { isLoved } },
    { new: true }
  );

  if (!scrobble) {
    throw new Error('Track not found');
  }

  return scrobble;
};

// ──────────────────────────────────────────────
// Top Artists Leaderboard
// ──────────────────────────────────────────────

export const getTopArtistsLeaderboard = async ({
  range = 'all-time',
  offset = 0,
  limit = 10
} = {}) => {
  const sanitizedLimit = safeLimit(limit, 10, 100);
  const { match: rangeMatch, window } = buildRangeMatch(range, offset);
  const baseMatch = {
    eventType: 'scrobble',
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
// Top Tracks Leaderboard
// ──────────────────────────────────────────────

export const getTopTracksLeaderboard = async ({
  range = 'all-time',
  offset = 0,
  limit = 15
} = {}) => {
  const sanitizedLimit = safeLimit(limit, 15, 100);
  const { match: rangeMatch, window } = buildRangeMatch(range, offset);
  const baseMatch = {
    eventType: 'scrobble',
    ...(rangeMatch || {})
  };

  const pipeline = [
    { $match: baseMatch },
    ...HYDRATE_PIPELINE,
    { $sort: { scrobbledAt: -1 } },
    {
      $group: {
        _id: '$track',
        artist: { $first: '$artist' },
        title: { $first: '$title' },
        album: { $first: '$album' },
        plays: { $sum: 1 },
        lastPlay: {
          $first: {
            scrobbledAt: '$scrobbledAt',
            connector: '$connector',
            source: '$source',
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
      title: doc.title,
      album: doc.album,
      plays: doc.plays,
      lastPlay: doc.lastPlay?.scrobbledAt,
      latestMedia: {
        trackArtUrl: doc.lastPlay?.trackArtUrl || null,
        animationUrl: doc.lastPlay?.animationUrl || null
      }
    }))
  };
};

// ──────────────────────────────────────────────
// Track Insights (single track detailed analytics)
// ──────────────────────────────────────────────

export const getTrackInsights = async ({
  artist,
  title,
  timezone = DEFAULT_TIMEZONE,
  recentLimit = 12
}) => {
  if (!artist || !title) {
    throw new Error('artist and title are required');
  }

  const tz = ensureTimezone(timezone);

  // Find the Artist + TrackMeta first
  const artistRegex = buildExactRegex(artist.trim());
  const titleRegex = buildExactRegex(title.trim());

  const artistDoc = await Artist.findOne({ nameLower: artist.trim().toLowerCase() });
  if (!artistDoc) return null;

  const trackMeta = await TrackMeta.findOne({
    artist: artistDoc._id,
    titleLower: title.trim().toLowerCase()
  }).populate('album');

  if (!trackMeta) return null;

  const baseMatch = {
    eventType: 'scrobble',
    track: trackMeta._id
  };

  const pipeline = [
    { $match: baseMatch },
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              plays: { $sum: 1 },
              firstPlay: { $min: '$scrobbledAt' },
              lastPlay: { $max: '$scrobbledAt' },
              loved: {
                $sum: {
                  $cond: [{ $eq: ['$isLoved', true] }, 1, 0]
                }
              },
              lovedInService: {
                $sum: {
                  $cond: [{ $eq: ['$isLovedInService', true] }, 1, 0]
                }
              }
            }
          }
        ],
        hourly: [
          {
            $group: {
              _id: {
                $hour: {
                  date: '$scrobbledAt',
                  timezone: tz
                }
              },
              plays: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ],
        daily: [
          {
            $group: {
              _id: {
                $isoDayOfWeek: {
                  date: '$scrobbledAt',
                  timezone: tz
                }
              },
              plays: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ],
        monthly: [
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$scrobbledAt',
                  timezone: tz
                }
              },
              plays: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
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
        sources: [
          {
            $group: {
              _id: '$source',
              plays: { $sum: 1 }
            }
          },
          { $sort: { plays: -1 } }
        ],
        userAgents: [
          {
            $match: {
              userAgent: { $exists: true, $ne: null }
            }
          },
          {
            $group: {
              _id: '$userAgent',
              plays: { $sum: 1 }
            }
          },
          { $sort: { plays: -1 } },
          { $limit: 10 }
        ],
        recent: [
          { $sort: { scrobbledAt: -1 } },
          { $limit: safeLimit(recentLimit, 12, 50) },
          {
            $project: {
              scrobbledAt: 1,
              connector: 1,
              source: 1,
              metadataLabel: 1,
              isLoved: 1,
            }
          }
        ]
      }
    }
  ];

  const [result] = await Scrobble.aggregate(pipeline);
  const overview = result?.overview?.[0];

  if (!overview || overview.plays === 0) {
    return null;
  }

  // Find related tracks by the same artist (excluding this track)
  const related = await Scrobble.aggregate([
    {
      $match: {
        eventType: 'scrobble'
      }
    },
    {
      $lookup: {
        from: 'trackmetas',
        localField: 'track',
        foreignField: '_id',
        as: 'tm'
      }
    },
    { $unwind: '$tm' },
    {
      $match: {
        'tm.artist': artistDoc._id,
        track: { $ne: trackMeta._id }
      }
    },
    {
      $group: {
        _id: '$track',
        title: { $first: '$tm.title' },
        plays: { $sum: 1 },
        lastPlay: { $max: '$scrobbledAt' }
      }
    },
    { $sort: { plays: -1 } },
    { $limit: 5 }
  ]);

  // Add recent scrobble info (with artist/title/album for response compatibility)
  const recentWithMeta = (result?.recent || []).map((r) => ({
    ...r,
    title: trackMeta.title,
    artist: artistDoc.name,
    album: trackMeta.album?.name || '',
    trackArtUrl: trackMeta.trackArtUrl,
    animationUrl: trackMeta.animationUrl,
    duration: trackMeta.duration,
  }));

  return {
    meta: {
      title: title,
      artist: artist,
      album: trackMeta.album?.name || null,
      trackArtUrl: trackMeta.trackArtUrl || null,
      animationUrl: trackMeta.animationUrl || null,
      appleMusicUrl: trackMeta.appleMusicUrl || null
    },
    overview: {
      totalScrobbles: overview.plays,
      firstPlay: overview.firstPlay,
      lastPlay: overview.lastPlay,
      lovedCount: overview.loved + overview.lovedInService,
      averageDurationSeconds: trackMeta.duration ? Math.round(trackMeta.duration) : 0
    },
    distributions: {
      hourly: fillHourlyBuckets(result?.hourly || []),
      daily: fillDailyBuckets(result?.daily || []),
      monthly: (result?.monthly || []).map((doc) => ({
        bucket: doc._id,
        plays: doc.plays
      }))
    },
    connectors: normalizeConnectorDocs(result?.connectors),
    sources: normalizeSourceDocs(result?.sources),
    userAgents: (result?.userAgents || []).map((doc) => ({
      userAgent: doc._id,
      plays: doc.plays
    })),
    recent: recentWithMeta,
    relatedTracks: related,
    spotify: trackMeta.spotify || null,
    spotifyMeta: trackMeta.spotify_search_attempted
      ? {
          enriched: trackMeta.spotify_enriched,
          matchFound: trackMeta.spotify_match_found,
          searchAttempted: trackMeta.spotify_search_attempted
        }
      : null
  };
};

// ──────────────────────────────────────────────
// Album Insights
// ──────────────────────────────────────────────

export const getAlbumInsights = async ({
  artist,
  album,
  recentLimit = 12,
  timezone = DEFAULT_TIMEZONE
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

// ──────────────────────────────────────────────
// Artist Profile
// ──────────────────────────────────────────────

export const getArtistProfileData = async ({
  name,
  tz = DEFAULT_TIMEZONE,
  topLimit = 10,
  recentLimit = 15
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
