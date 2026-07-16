import Scrobble from '../../models/Scrobble.js';
import TrackMeta from '../../models/TrackMeta.js';
import Artist from '../../models/Artist.js';
import {
  HYDRATE_PIPELINE,
  TRACKMETA_JOIN,
  buildRangeMatch,
  userScope,
  toObjectId,
  safeLimit,
  ensureTimezone,
  toIsoString,
  normalizeConnectorDocs,
  DEFAULT_TIMEZONE,
  WEEKDAY_LABELS,
  withAnalyticsCache,
  analyticsCacheKey,
  CACHE_TTL,
  invalidateUserAnalytics
} from './shared.js';

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

// The subset of SORTABLE_TRACK_FIELDS that only exists after HYDRATE_PIPELINE
// joins TrackMeta/Artist/Album. Sorting on these forces hydration up-front;
// the rest live on the scrobble itself and can be sorted before joining.
const HYDRATE_SORT_FIELDS = new Set(['artist', 'title', 'album', 'duration']);

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

const normalizeSourceDocs = (docs = []) => {
  return docs
    .filter((doc) => doc && doc._id)
    .map((doc) => ({
      source: doc._id,
      plays: doc.plays
    }));
};

// ──────────────────────────────────────────────
// Tracks Listing (paginated)
// ──────────────────────────────────────────────

const computeTracksListing = async ({
  page,
  limit,
  offset,
  sortBy,
  order,
  search,
  searchTitle,
  searchArtist,
  searchAlbum,
  connector,
  source,
  range = 'all-time',
  rangeOffset = 0,
  userId = null
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
    ...userScope(userId),
    ...(rangeMatch || {})
  };
  if (connector) scrobbleMatch.connector = connector;
  if (source) scrobbleMatch.source = source;

  // Search filters run on hydrated fields (artist/title/album names), so they
  // are collected separately from the scrobble-level match.
  const searchStages = [];

  // Global search query
  if (search && typeof search === 'string') {
    const keywords = search.trim();
    if (keywords.length > 0) {
      const regex = new RegExp(keywords.replace(/\s+/g, '.*'), 'i');
      searchStages.push({
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

  // Field-specific search queries (combinable via $and inside the match pipeline step)
  const fieldMatches = {};
  if (searchTitle?.trim()) {
    fieldMatches.title = new RegExp(searchTitle.trim().replace(/\s+/g, '.*'), 'i');
  }
  if (searchArtist?.trim()) {
    fieldMatches.artist = new RegExp(searchArtist.trim().replace(/\s+/g, '.*'), 'i');
  }
  if (searchAlbum?.trim()) {
    fieldMatches.album = new RegExp(searchAlbum.trim().replace(/\s+/g, '.*'), 'i');
  }

  if (Object.keys(fieldMatches).length > 0) {
    searchStages.push({ $match: fieldMatches });
  }

  // Hydration is only required up-front when something downstream reads a joined
  // field: a search filter, or a sort on artist/title/album/duration. Otherwise
  // we sort+paginate on the raw scrobbles and join only the page's rows.
  const needsHydrateForFilter = searchStages.length > 0;
  const needsHydrateForSort = HYDRATE_SORT_FIELDS.has(sanitizedSortField);
  const hydrateFirst = needsHydrateForFilter || needsHydrateForSort;

  // Count total after filtering. Without a search filter, the only thing
  // HYDRATE_PIPELINE changes about the count is dropping scrobbles whose
  // TrackMeta is gone — so the TrackMeta join alone gives the same number
  // without paying for the artist/album joins.
  const countPipeline = needsHydrateForFilter
    ? [{ $match: scrobbleMatch }, ...HYDRATE_PIPELINE, ...searchStages, { $count: 'total' }]
    : [{ $match: scrobbleMatch }, ...TRACKMETA_JOIN, { $count: 'total' }];
  const [countResult] = await Scrobble.aggregate(countPipeline);
  const total = countResult?.total || 0;

  const pageStages = [
    { $sort: { [sanitizedSortField]: sanitizedOrder } },
    { $skip: skip },
    { $limit: sanitizedLimit }
  ];
  const pipeline = hydrateFirst
    ? [{ $match: scrobbleMatch }, ...HYDRATE_PIPELINE, ...searchStages, ...pageStages]
    : [{ $match: scrobbleMatch }, ...pageStages, ...HYDRATE_PIPELINE];

  const tracks = await Scrobble.aggregate(pipeline);

  // Calculate userPlayCount per track — one grouped count for the whole page
  // instead of one countDocuments per row (was N+1, up to `limit` queries).
  const pageTrackIds = tracks.map((s) => s.track).filter(Boolean);
  const playCounts = pageTrackIds.length
    ? await Scrobble.aggregate([
        { $match: { eventType: 'scrobble', ...userScope(userId), track: { $in: pageTrackIds } } },
        { $group: { _id: '$track', count: { $sum: 1 } } }
      ])
    : [];
  const playCountByTrack = new Map(playCounts.map((c) => [String(c._id), c.count]));
  const tracksWithPlayCount = tracks.map((scrobble) => ({
    ...scrobble,
    userPlayCount: playCountByTrack.get(String(scrobble.track)) || 0
  }));

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

export const updateLovedTrackStatus = async ({ id, isLoved, userId = null }) => {
  if (!id) {
    throw new Error('Track id is required');
  }
  if (typeof isLoved !== 'boolean') {
    throw new Error('isLoved must be a boolean value');
  }

  // Scope to the owner so a user can't toggle someone else's scrobble
  const filter = { _id: id };
  const oid = toObjectId(userId);
  if (oid) filter.user = oid;

  const scrobble = await Scrobble.findOneAndUpdate(
    filter,
    { $set: { isLoved } },
    { new: true }
  );

  if (!scrobble) {
    throw new Error('Track not found');
  }

  // Loved flag changed → drop this user's cached analytics.
  await invalidateUserAnalytics(userId);

  return scrobble;
};

// ──────────────────────────────────────────────
// Top Tracks Leaderboard
// ──────────────────────────────────────────────

const computeTopTracksLeaderboard = async ({
  range = 'all-time',
  offset = 0,
  limit = 15,
  userId = null
} = {}) => {
  const sanitizedLimit = safeLimit(limit, 15, 100);
  const { match: rangeMatch, window } = buildRangeMatch(range, offset);
  const baseMatch = {
    eventType: 'scrobble',
    ...userScope(userId),
    ...(rangeMatch || {})
  };

  // Group by track (present on the scrobble) BEFORE hydrating, so the 3-table
  // join runs only on the top-N tracks instead of every scrobble in range.
  const pipeline = [
    { $match: baseMatch },
    { $sort: { scrobbledAt: -1 } },
    {
      $group: {
        _id: '$track',
        plays: { $sum: 1 },
        lastPlay: { $first: '$scrobbledAt' }
      }
    },
    { $sort: { plays: -1 } },
    { $limit: sanitizedLimit },
    { $addFields: { track: '$_id' } },
    ...HYDRATE_PIPELINE
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
      lastPlay: doc.lastPlay,
      latestMedia: {
        trackArtUrl: doc.trackArtUrl || null,
        animationUrl: doc.animationUrl || null
      }
    }))
  };
};

// ──────────────────────────────────────────────
// Track Insights (single track detailed analytics)
// ──────────────────────────────────────────────

const computeTrackInsights = async ({
  artist,
  title,
  timezone = DEFAULT_TIMEZONE,
  recentLimit = 12,
  userId = null
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
    ...userScope(userId),
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

  // Find related tracks by the same artist (excluding this track).
  // Prefilter to this artist's track ids (indexed TrackMeta.find) and match
  // scrobbles by track $in, instead of joining trackmetas on every scrobble
  // then filtering by artist. The title lookup runs only on the top 5.
  const artistTrackIds = await TrackMeta.find({ artist: artistDoc._id }).distinct('_id');
  const related = await Scrobble.aggregate([
    {
      $match: {
        eventType: 'scrobble',
        ...userScope(userId),
        track: { $in: artistTrackIds, $ne: trackMeta._id }
      }
    },
    {
      $group: {
        _id: '$track',
        plays: { $sum: 1 },
        lastPlay: { $max: '$scrobbledAt' }
      }
    },
    { $sort: { plays: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: 'trackmetas',
        localField: '_id',
        foreignField: '_id',
        as: 'tm'
      }
    },
    { $unwind: '$tm' }
  ]).then((rows) =>
    // Preserve the original field order (_id, title, plays, lastPlay).
    rows.map((r) => ({ _id: r._id, title: r.tm.title, plays: r.plays, lastPlay: r.lastPlay }))
  );

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

export const getTracksListing = (args = {}) =>
  withAnalyticsCache(
    analyticsCacheKey('tracks', args.userId, [
      args.page, args.limit, args.offset, args.sortBy, args.order,
      args.search, args.searchTitle, args.searchArtist, args.searchAlbum,
      args.connector, args.source, args.range, args.rangeOffset
    ]),
    CACHE_TTL.tracks,
    () => computeTracksListing(args)
  );

export const getTopTracksLeaderboard = (args = {}) =>
  withAnalyticsCache(
    analyticsCacheKey('top-tracks', args.userId, [
      args.range, args.offset, args.limit
    ]),
    CACHE_TTL.leaderboard,
    () => computeTopTracksLeaderboard(args)
  );

export const getTrackInsights = (args = {}) =>
  withAnalyticsCache(
    analyticsCacheKey('track', args.userId, [
      args.artist, args.title, args.timezone, args.recentLimit
    ]),
    CACHE_TTL.insights,
    () => computeTrackInsights(args)
  );
