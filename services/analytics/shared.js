import { toObjectId, userScope } from '../../utils/objectId.js';

export { toObjectId, userScope };

export const RANGE_CONFIG = {
  week: { ms: 7 * 24 * 60 * 60 * 1000 },
  month: { months: 1 },
  year: { years: 1 },
  'all-time': null
};

export const DEFAULT_TIMEZONE = 'UTC';
export const MAX_TRACK_LIMIT = 200;
export const DEFAULT_TRACK_LIMIT = 50;

export const WEEKDAY_LABELS = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun'
};

export const sanitizeRange = (range = 'all-time') => {
  if (typeof range !== 'string') return 'all-time';
  const normalized = range.toLowerCase();
  return RANGE_CONFIG[normalized] ? normalized : 'all-time';
};

export const sanitizeOffset = (offset = 0) => {
  const value = Number(offset);
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
};

export const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

export const subtractWindow = (date, config, multiplier = 1) => {
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

export const buildRangeMatch = (range, offset, field = 'scrobbledAt') => {
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

export const safeLimit = (limit, fallback = DEFAULT_TRACK_LIMIT, max = MAX_TRACK_LIMIT) => {
  const value = Number(limit);
  if (Number.isFinite(value) && value > 0) {
    return clampNumber(Math.floor(value), 1, max);
  }
  return fallback;
};

export const ensureTimezone = (tz) => {
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

export const toIsoString = (date) => (date ? date.toISOString() : null);

export const normalizeConnectorDocs = (docs = []) => {
  return docs
    .filter((doc) => doc && doc._id)
    .map((doc) => ({
      connector: doc._id,
      plays: doc.plays
    }));
};

// ──────────────────────────────────────────────
// Common $lookup stages to hydrate Scrobble docs
// ──────────────────────────────────────────────

export const HYDRATE_PIPELINE = [
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

export const buildRecentProjection = () => ({
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
