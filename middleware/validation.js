const toDate = (value) => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim() === '') return null;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return null;
  // Treat values larger than 1e12 as already in milliseconds
  const millis = num > 1e12 ? num : num * 1000;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const normalizeListenBrainzEntry = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('ListenBrainz payload ต้องเป็น JSON object');
  }

  const metadata = payload.track_metadata || {};
  const mapping = metadata.mbid_mapping || {};
  const additionalInfo = metadata.additional_info || {};

  let title = metadata.track_name || metadata.recording_name || mapping.recording_name || payload.title || '';
  let artist = metadata.artist_name;

  if (!artist && Array.isArray(mapping.artists)) {
    artist = mapping.artists
      .map((artistItem) => {
        const name = artistItem?.artist_credit_name || '';
        const joinPhrase = artistItem?.join_phrase || '';
        return `${name}${joinPhrase}`;
      })
      .join('')
      .trim() || null;
  }

  const album = metadata.release_name || '';

  let duration = null;
  if (typeof additionalInfo.duration_ms === 'number') {
    duration = Math.round(additionalInfo.duration_ms / 1000);
  } else if (typeof additionalInfo.duration === 'number') {
    duration = Math.round(additionalInfo.duration);
  }

  const coverArtCandidates = [
    additionalInfo.cover_art_url,
    additionalInfo.coverart,
    additionalInfo.album_art_url,
    additionalInfo.album_coverart_url,
    additionalInfo.track_art_url,
    additionalInfo.image,
    additionalInfo.image_url,
  ].filter((value) => typeof value === 'string' && value.trim().length > 0);

  let trackArtUrl = null;
  if (coverArtCandidates.length > 0) {
    trackArtUrl = coverArtCandidates[0];
  } else {
    const releaseForCover = mapping.caa_release_mbid || mapping.release_mbid;
    if (releaseForCover) {
      trackArtUrl = mapping.caa_id
        ? `https://coverartarchive.org/release/${releaseForCover}/${mapping.caa_id}.jpg`
        : `https://coverartarchive.org/release/${releaseForCover}/front`;
    }
  }

  const listenedAt = toDate(payload.listened_at);
  const insertedAt = toDate(payload.inserted_at);
  const timestamp =
    listenedAt ||
    insertedAt ||
    toDate(payload.timestamp) ||
    toDate(payload.time) ||
    null;

  return {
    title,
    artist,
    album,
    duration,
    connector: 'listenbrainz',
    originalUrl: additionalInfo.listen_url || additionalInfo.track_url || additionalInfo.origin_url || '',
    eventName: 'scrobble',
    rawFormat: 'listenbrainz-import',
    source: 'listenbrainz',
    trackArtUrl: trackArtUrl || null,
    timestamp,
    listenedAt,
    insertedAt,
  };
};

// Validation middleware for webhook data

export const validateTrackData = (req, res, next) => {
  const { body } = req;

  // Log the incoming data for debugging (only if enabled)
  if (process.env.DEBUG_VALIDATION === 'true') {
    console.log('🔍 Validating track data:', JSON.stringify(body, null, 2));
  }

  // Check if body exists
  if (!body || typeof body !== 'object') {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Request body must be a valid JSON object'
    });
  }

  // Track data validation - support multiple formats
  let title, artist, album, duration, connector, originUrl;
  let trackArtUrl = null;
  let artistUrl = null;
  let trackUrl = null;
  let albumUrl = null;
  let metadataLabel = null;
  let animationUrl = null;
  let masterTallUrl = null;
  let primaryMediaUrl = null;
  let primaryMediaType = null;
  let userPlayCount = null;
  let isLovedInService = null;
  let startTimestamp = null;
  let currentTime = null;
  let eventName = body.eventName || null;
  let rawFormat = 'simple';
  let timestamp = body.time || null;
  let source = body.source || '';
  let listenedAt = null;
  let insertedAt = null;

  const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
  const coerceNumber = (value) => {
    if (value === undefined || value === null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const normalizeStartTimestamp = (value) => {
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
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };
  const applyMetadata = (metadataSource) => {
    if (!metadataSource || typeof metadataSource !== 'object') return;

    if (isNonEmptyString(metadataSource.trackArtUrl)) {
      trackArtUrl = metadataSource.trackArtUrl.trim();
    }
    if (isNonEmptyString(metadataSource.artistUrl)) {
      artistUrl = metadataSource.artistUrl.trim();
    }
    if (isNonEmptyString(metadataSource.trackUrl)) {
      trackUrl = metadataSource.trackUrl.trim();
    }
    if (isNonEmptyString(metadataSource.albumUrl)) {
      albumUrl = metadataSource.albumUrl.trim();
    }
    if (isNonEmptyString(metadataSource.label)) {
      metadataLabel = metadataSource.label.trim();
    }
    if (isNonEmptyString(metadataSource.animationUrl)) {
      animationUrl = metadataSource.animationUrl.trim();
    }
    if (isNonEmptyString(metadataSource.masterTallUrl)) {
      masterTallUrl = metadataSource.masterTallUrl.trim();
    }
    if (isNonEmptyString(metadataSource.primaryMediaUrl)) {
      primaryMediaUrl = metadataSource.primaryMediaUrl.trim();
    }
    if (isNonEmptyString(metadataSource.primaryMediaType)) {
      primaryMediaType = metadataSource.primaryMediaType.trim();
    }
    const count = coerceNumber(metadataSource.userPlayCount);
    if (count !== null) {
      userPlayCount = count;
    }
    if (typeof metadataSource.userloved === 'boolean') {
      isLovedInService = metadataSource.userloved;
    } else if (typeof metadataSource.isLoved === 'boolean') {
      isLovedInService = metadataSource.isLoved;
    }
    const metaStart = normalizeStartTimestamp(metadataSource.startTimestamp);
    if (metaStart) {
      startTimestamp = metaStart;
    }
    const metaCurrentTime = coerceNumber(metadataSource.currentTime);
    if (metaCurrentTime !== null) {
      currentTime = metaCurrentTime;
    }
  };

  applyMetadata(body.metadata);
  if (body.data && typeof body.data === 'object') {
    applyMetadata(body.data.metadata);
  }

  // Format 1: ListenBrainz import format
  if (body.track_metadata && (body.listened_at || body.inserted_at || body.track_metadata.track_name)) {
    try {
      const normalized = normalizeListenBrainzEntry(body);
      ({
        title,
        artist,
        album,
        duration,
        connector,
        originalUrl: originUrl,
        eventName,
        rawFormat,
        source,
        trackArtUrl,
        timestamp,
        listenedAt,
        insertedAt,
      } = normalized);
    } catch (error) {
      return res.status(400).json({
        error: 'Validation failed',
        message: error.message || 'ไม่สามารถอ่านข้อมูล ListenBrainz ได้'
      });
    }

    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected ListenBrainz import format');
    }
  }
  // Format 2: Web-scrobbler new format (eventName + data.song)
  else if (body.eventName && body.data && body.data.song) {
    const song = body.data.song;
    
    // Prefer processed first, then parsed, then noRegex
    const trackData = song.processed || song.parsed || song.noRegex || {};
    applyMetadata(song.metadata);
    const ct = coerceNumber(trackData.currentTime);
    if (ct !== null) {
      currentTime = ct;
    }
    title = trackData.track;
    artist = trackData.artist;
    album = trackData.album;
    duration = trackData.duration;
    connector = song.connector ? (song.connector.label || song.connector.id) : '';
    originUrl = trackData.originUrl || '';
    rawFormat = 'web-scrobbler-new';
    source = 'web-scrobbler';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected Web-scrobbler new format');
    }
  }
  // Format 3: Standard web-scrobbler format
  else if (body.track && typeof body.track === 'object') {
    title = body.track.title || body.track.name;
    artist = body.track.artist;
    album = body.track.album;
    duration = body.track.duration;
    applyMetadata(body.track.metadata);
    connector = body.connector || body.source;
    originUrl = body.track.url || body.url || '';
    rawFormat = 'web-scrobbler-standard';
    source = body.source || 'web-scrobbler';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected standard web-scrobbler format');
    }
  }
  // Format 4: Now playing format
  else if (body.nowPlaying) {
    title = body.nowPlaying.title || body.nowPlaying.track;
    artist = body.nowPlaying.artist;
    album = body.nowPlaying.album;
    duration = body.nowPlaying.duration;
    applyMetadata(body.nowPlaying.metadata);
    connector = body.source || 'web-scrobbler';
    originUrl = body.nowPlaying.url || '';
    rawFormat = 'now-playing';
    source = body.source || 'web-scrobbler';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected now playing format');
    }
  }
  // Format 5: Simple format
  else {
    title = body.title || body.track;
    artist = body.artist;
    album = body.album;
    duration = body.duration;
    connector = body.connector || body.source;
    originUrl = body.url || '';
    rawFormat = 'simple';
    source = body.source || '';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected simple format');
    }
  }

  if (currentTime === null && body.track && typeof body.track === 'object') {
    const trackCurrent = coerceNumber(body.track.currentTime);
    if (trackCurrent !== null) {
      currentTime = trackCurrent;
    }
  }

  if (currentTime === null) {
    const rootCurrent = coerceNumber(body.currentTime);
    if (rootCurrent !== null) {
      currentTime = rootCurrent;
    }
  }

  // Validate required fields
  if (!title || !artist) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Missing required fields: title and artist',
      received: {
        title: title || null,
        artist: artist || null
      },
      format: rawFormat,
      debug: process.env.NODE_ENV === 'development' ? {
        bodyKeys: Object.keys(body),
        detectedPath: rawFormat === 'listenbrainz-import'
          ? 'track_metadata.*'
          : (body.eventName ? 'data.song.parsed/processed' : (body.track ? 'track.*' : 'root.*'))
      } : undefined
    });
  }

  // Validate field types and lengths
  if (typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Title must be a non-empty string'
    });
  }

  if (typeof artist !== 'string' || artist.trim().length === 0) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Artist must be a non-empty string'
    });
  }

  // Check field lengths
  if (title.length > 500) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Title is too long (max 500 characters)'
    });
  }

  if (artist.length > 200) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Artist name is too long (max 200 characters)'
    });
  }

  // Validate optional fields
  if (album && album.length > 300) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Album name is too long (max 300 characters)'
    });
  }

  if (duration && (typeof duration !== 'number' || duration < 0)) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Duration must be a positive number'
    });
  }

  // Attach validated data to request for easier access
  req.validatedTrack = {
    title: title.trim(),
    artist: artist.trim(),
    album: album ? album.trim() : '',
    duration: duration || null,
    connector: connector || '',
    originalUrl: originUrl || '',
    eventName,
    timestamp: timestamp || null,
    rawFormat,
    source,
    listenedAt,
    insertedAt,
    trackArtUrl: trackArtUrl || null,
    artistUrl: artistUrl || null,
    trackUrl: trackUrl || null,
    albumUrl: albumUrl || null,
    userPlayCount: userPlayCount !== null ? userPlayCount : null,
    isLovedInService: typeof isLovedInService === 'boolean' ? isLovedInService : null,
    startTimestamp: startTimestamp || null,
    currentTime: currentTime !== null ? currentTime : null,
    metadataLabel: metadataLabel || null,
    animationUrl: animationUrl || null,
    masterTallUrl: masterTallUrl || null,
    primaryMediaUrl: primaryMediaUrl || null,
    primaryMediaType: primaryMediaType || null,
  };

  console.log('✅ Track data validation passed');
  if (process.env.DEBUG_VALIDATION === 'true') {
    console.log('   Validated track:', req.validatedTrack);
  }
  next();
};

// API key validation middleware
export const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedApiKey = process.env.API_KEY;

  if (!expectedApiKey) {
    // If no API key is configured, skip validation
    return next();
  }

  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key'
    });
  }

  next();
};

// Request logging middleware
export const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  // console.log(`📨 ${req.method} ${req.originalUrl} - ${req.ip} - ${new Date().toISOString()}`);
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusIcon = res.statusCode >= 400 ? '❌' : '✅';
    // console.log(`${statusIcon} ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
  });

  next();
};

// Content type validation
export const validateContentType = (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    const contentType = req.headers['content-type'];
    
    if (!contentType || !contentType.includes('application/json')) {
      return res.status(400).json({
        error: 'Invalid content type',
        message: 'Content-Type must be application/json'
      });
    }
  }
  
  next();
};

// Error handling wrapper for async routes
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Rate limit info middleware
export const rateLimitInfo = (req, res, next) => {
  res.on('finish', () => {
    if (res.get('X-RateLimit-Remaining')) {
      console.log(`📊 Rate limit: ${res.get('X-RateLimit-Remaining')} requests remaining`);
    }
  });
  next();
};

export default {
  validateTrackData,
  validateApiKey,
  requestLogger,
  validateContentType,
  asyncHandler,
  rateLimitInfo
};
