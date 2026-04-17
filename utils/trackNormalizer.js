/**
 * trackNormalizer.js
 * 
 * Centralized data normalization utilities for incoming track/scrobble payloads.
 * Consolidates logic previously duplicated across Track.js, validation.js,
 * and scrobbleService.js into a single, testable module.
 */

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

export const SOURCE_VALUES = [
  'web-scrobbler',
  'last.fm',
  'spotify',
  'apple-music',
  'listenbrainz',
  'listenbrainz-import',
  'listenbrainz lastfm importer v2',
  'other'
];

// ──────────────────────────────────────────────
// Primitive Coercion Helpers
// ──────────────────────────────────────────────

/**
 * Safely coerce a value to a finite number, returning null on failure.
 * @param {*} value
 * @returns {number|null}
 */
export const coerceNumber = (value) => {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

/**
 * Check if a value is a non-empty string (after trimming).
 * @param {*} value
 * @returns {boolean}
 */
export const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

// ──────────────────────────────────────────────
// Date / Timestamp Normalization
// ──────────────────────────────────────────────

/**
 * Normalize a value into a valid Date instance or null.
 * Handles epoch seconds, epoch milliseconds, Date objects, and ISO strings.
 * 
 * @param {*} value - The value to normalize.
 * @returns {Date|null}
 */
export const normalizeDate = (value) => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'string' && value.trim() === '') return null;

  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num === 'number' && Number.isFinite(num)) {
    // Treat values larger than 1e12 as already in milliseconds
    const millis = num > 1e12 ? num : num * 1000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  // Last resort: try parsing as a date string
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
};

/**
 * Parse a "startTimestamp" value that may be epoch seconds, epoch
 * milliseconds, a Date object, or an ISO string.
 *
 * @param {*} value
 * @returns {Date|null}
 */
export const normalizeStartTimestamp = (value) => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return null;
  }
  const numeric = coerceNumber(value);
  if (numeric !== null) {
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
};

// ──────────────────────────────────────────────
// Source Normalization
// ──────────────────────────────────────────────

/**
 * Normalize a source string to one of the allowed SOURCE_VALUES.
 * Falls back to 'web-scrobbler' for falsy / unrecognized values.
 *
 * @param {*} value
 * @returns {string}
 */
export const normalizeSource = (value) => {
  if (!value) return 'web-scrobbler';
  const normalized = value.toString().trim().toLowerCase();
  return SOURCE_VALUES.includes(normalized) ? normalized : 'other';
};

// ──────────────────────────────────────────────
// Cover Art Derivation
// ──────────────────────────────────────────────

/**
 * Attempt to derive a track art URL from a raw webhook payload.
 * Checks multiple nested locations, falling back to constructing a
 * Cover Art Archive URL when MusicBrainz IDs are available.
 *
 * @param {Object} rawPayload - The raw webhook payload or sub-object.
 * @param {string|null} existingUrl - An existing art URL to prefer.
 * @returns {string|null}
 */
export const deriveTrackArtUrl = (rawPayload, existingUrl = null) => {
  if (existingUrl && typeof existingUrl === 'string' && existingUrl.trim().length > 0) {
    return existingUrl;
  }
  if (!rawPayload || typeof rawPayload !== 'object') {
    return existingUrl;
  }

  const trackMetadata = rawPayload.track_metadata || rawPayload.trackMetadata || {};
  const additionalInfo = trackMetadata.additional_info || trackMetadata.additionalInfo || {};
  const mapping = trackMetadata.mbid_mapping || trackMetadata.mbidMapping || {};

  const candidates = [
    additionalInfo.cover_art_url,
    additionalInfo.coverart,
    additionalInfo.album_art_url,
    additionalInfo.album_coverart_url,
    additionalInfo.track_art_url,
    additionalInfo.image,
    additionalInfo.image_url,
    rawPayload.trackArtUrl, // fallback if importer placed it at root
  ].filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);

  if (candidates.length > 0) {
    return candidates[0];
  }

  const releaseForCover = mapping.caa_release_mbid || mapping.release_mbid;
  if (releaseForCover) {
    if (mapping.caa_id) {
      return `https://coverartarchive.org/release/${releaseForCover}/${mapping.caa_id}.jpg`;
    }
    return `https://coverartarchive.org/release/${releaseForCover}/front`;
  }

  return existingUrl;
};

// ──────────────────────────────────────────────
// Metadata Merging
// ──────────────────────────────────────────────

/**
 * Non-destructively merge metadata from `source` into `target`.
 * Only sets a key when the source value is non-empty / valid.
 *
 * @param {Object} target - Existing metadata object.
 * @param {Object} source - New metadata to merge.
 * @returns {Object} A new merged metadata object.
 */
export const mergeMetadata = (target = {}, source = {}) => {
  if (!source || typeof source !== 'object') return target;
  const next = { ...target };

  const setString = (key, value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      next[key] = value.trim();
    }
  };

  setString('trackArtUrl', source.trackArtUrl);
  setString('artistUrl', source.artistUrl);
  setString('trackUrl', source.trackUrl);
  setString('albumUrl', source.albumUrl);
  setString('metadataLabel', source.label ?? source.metadataLabel);
  setString('animationUrl', source.animationUrl);
  setString('masterTallUrl', source.masterTallUrl);
  setString('primaryMediaUrl', source.primaryMediaUrl);
  setString('primaryMediaType', source.primaryMediaType);

  const userPlayCount = coerceNumber(source.userPlayCount);
  if (userPlayCount !== null) {
    next.userPlayCount = userPlayCount;
  }

  if (typeof source.userloved === 'boolean') {
    next.isLovedInService = source.userloved;
  }
  if (typeof source.isLovedInService === 'boolean') {
    next.isLovedInService = source.isLovedInService;
  }
  if (typeof source.isLoved === 'boolean') {
    next.isLovedInService = source.isLoved;
  }

  const start = normalizeStartTimestamp(source.startTimestamp);
  if (start) {
    next.startTimestamp = start;
  }

  const current = coerceNumber(source.currentTime);
  if (current !== null) {
    next.currentTime = current;
  }

  return next;
};

// ──────────────────────────────────────────────
// Name Cleaning (Normalization)
// ──────────────────────────────────────────────

/**
 * Clean album name suffixes like '- EP', '(Single)', '(Deluxe Version)', etc.
 * This ensures that variants log under the same canonical album name pattern.
 *
 * @param {string} name - The album name (usually already lowercase).
 * @returns {string} - The cleaned album name.
 */
export const cleanAlbumName = (name) => {
  if (!name || typeof name !== 'string') return '';
  let cleaned = name.trim();
  
  // RegExp to match common suffixes at the end of the string.
  // Case-insensitive ('i' flag)
  const regex = /(?:\s*-\s*ep|\s*\(\s*ep\s*\)|\s*-\s*single|\s*\(\s*single\s*\)|\s*-\s*the\s*[\d\w]+\s*mini\s*album|\s*\(deluxe\s*version\)|\s*\[deluxe\s*version\]|\s*\(deluxe\)|\s*\[deluxe\]|\s*\(original\s*motion\s*picture\s*soundtrack\)|\s*\(original\s*soundtrack\)|\s*-\s*original\s*soundtrack|\s*\(feat\..*?\)|\s*\(ft\..*?\))$/i;
  
  // Apply regex replacement
  const stripped = cleaned.replace(regex, '');
  
  // Return stripped value, or if it stripped everything (weird edge case), return original
  return stripped.trim() || cleaned;
};

// ──────────────────────────────────────────────
// Track Field Normalization (pre-save)
// ──────────────────────────────────────────────

/**
 * Trim and clean string fields on a track document.
 * Designed to be called from a Mongoose pre-save hook.
 *
 * @param {Object} doc - Mongoose document (mutated in place).
 */
export const normalizeTrackFields = (doc) => {
  if (doc.title && typeof doc.title === 'string') doc.title = doc.title.trim();
  if (doc.artist && typeof doc.artist === 'string') doc.artist = doc.artist.trim();
  if (doc.album && typeof doc.album === 'string') doc.album = doc.album.trim();
  if (doc.albumArtist && typeof doc.albumArtist === 'string') doc.albumArtist = doc.albumArtist.trim();
};

// ──────────────────────────────────────────────
// Full Track Data Builder (from raw webhook input)
// ──────────────────────────────────────────────

/**
 * Build a canonical, normalized track data object from a raw webhook payload.
 * This was previously inlined inside Track.findOrCreateTrack.
 *
 * @param {Object} trackData - The incoming track data (from middleware / service).
 * @param {string} eventType - The resolved event type.
 * @returns {Object} Canonical data suitable for Mongoose create/update.
 */
export const buildNormalizedTrackData = (trackData, eventType) => {
  // Prefer the raw webhook payload (data.song) when available
  const songRoot =
    trackData?.song ||
    trackData?.data?.song ||
    trackData?.rawData?.data?.song ||
    {};

  // Build canonical data, preferring "processed" fields first, then "parsed", then top-level fallbacks
  const processed = songRoot?.processed || {};
  const parsed = songRoot?.parsed || {};
  const metadata = songRoot?.metadata || {};
  const connectorInfo = songRoot?.connector || {};

  const normalizedTimestamp = normalizeDate(trackData?.timestamp) || new Date();
  const normalizedScrobbledAt = normalizeDate(trackData?.scrobbledAt) || normalizedTimestamp;

  const data = {
    // Core identity: strictly prefer processed
    title: processed.track ?? parsed.track ?? trackData?.title,
    artist: processed.artist ?? parsed.artist ?? trackData?.artist,
    album: processed.album ?? parsed.album ?? trackData?.album,
    albumArtist: processed.albumArtist ?? parsed.albumArtist ?? trackData?.albumArtist,

    // Duration: prefer processed, then parsed, then any provided fallback
    duration:
      processed.duration ??
      parsed.duration ??
      trackData?.duration ??
      undefined,

    // Source / connector and URLs
    connector:
      connectorInfo?.id ??
      connectorInfo?.label ??
      trackData?.connector ??
      undefined,
    originalUrl: parsed?.originUrl ?? trackData?.originalUrl ?? undefined,

    // Last.fm / service metadata mirrors
    trackArtUrl: metadata?.trackArtUrl ?? trackData?.trackArtUrl ?? undefined,
    artistUrl: metadata?.artistUrl ?? trackData?.artistUrl ?? undefined,
    trackUrl: metadata?.trackUrl ?? trackData?.trackUrl ?? undefined,
    albumUrl: metadata?.albumUrl ?? trackData?.albumUrl ?? undefined,
    metadataLabel: metadata?.label ?? trackData?.metadataLabel ?? undefined,
    animationUrl: metadata?.animationUrl ?? trackData?.animationUrl ?? undefined,
    masterTallUrl: metadata?.masterTallUrl ?? trackData?.masterTallUrl ?? undefined,
    primaryMediaUrl: metadata?.primaryMediaUrl ?? trackData?.primaryMediaUrl ?? undefined,
    primaryMediaType: metadata?.primaryMediaType ?? trackData?.primaryMediaType ?? undefined,
    userPlayCount: metadata?.userPlayCount ?? trackData?.userPlayCount ?? undefined,
    isLovedInService: metadata?.userloved ?? trackData?.isLovedInService ?? undefined,

    // Timing
    startTimestamp: metadata?.startTimestamp
      ? new Date(metadata.startTimestamp * 1000)
      : trackData?.startTimestamp,

    // Scrobble timing
    timestamp: normalizedTimestamp,
    scrobbledAt: normalizedScrobbledAt,

    // Flags / status
    isScrobbled: true,
    eventType,
    source: normalizeSource(trackData?.source),

    // Keep the raw webhook for debugging / audits
    rawData: trackData?.rawData || trackData,
    lastfmMbid: trackData?.lastfmMbid ?? undefined,
  };

  if (!data.trackArtUrl) {
    const derivedArt = deriveTrackArtUrl(trackData?.rawData || trackData, null);
    if (derivedArt) {
      data.trackArtUrl = derivedArt;
    }
  }

  return data;
};
