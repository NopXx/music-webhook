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

  // Format 1: Web-scrobbler new format (eventName + data.song)
  if (body.eventName && body.data && body.data.song) {
    const song = body.data.song;
    
    // Prefer processed first, then parsed, then noRegex
    const trackData = song.processed || song.parsed || song.noRegex || {};
    title = trackData.track;
    artist = trackData.artist;
    album = trackData.album;
    duration = trackData.duration;
    connector = song.connector ? (song.connector.label || song.connector.id) : '';
    originUrl = trackData.originUrl || '';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected Web-scrobbler new format');
    }
  }
  // Format 2: Standard web-scrobbler format
  else if (body.track) {
    title = body.track.title || body.track.name;
    artist = body.track.artist;
    album = body.track.album;
    duration = body.track.duration;
    connector = body.connector || body.source;
    originUrl = body.track.url || body.url || '';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected standard web-scrobbler format');
    }
  }
  // Format 3: Now playing format
  else if (body.nowPlaying) {
    title = body.nowPlaying.title || body.nowPlaying.track;
    artist = body.nowPlaying.artist;
    album = body.nowPlaying.album;
    duration = body.nowPlaying.duration;
    connector = body.source || 'web-scrobbler';
    originUrl = body.nowPlaying.url || '';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected now playing format');
    }
  }
  // Format 4: Simple format
  else {
    title = body.title;
    artist = body.artist;
    album = body.album;
    duration = body.duration;
    connector = body.connector || body.source;
    originUrl = body.url || '';
    
    if (process.env.DEBUG_VALIDATION === 'true') {
      console.log('✅ Detected simple format');
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
      format: body.eventName ? 'web-scrobbler-new' : (body.track ? 'web-scrobbler-standard' : 'simple'),
      debug: process.env.NODE_ENV === 'development' ? {
        bodyKeys: Object.keys(body),
        detectedPath: body.eventName ? 'data.song.parsed/processed' : (body.track ? 'track.*' : 'root.*')
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
    eventName: body.eventName || null,
    timestamp: body.time || null,
    rawFormat: body.eventName ? 'web-scrobbler-new' : (body.track ? 'web-scrobbler-standard' : 'simple')
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
  console.log(`📨 ${req.method} ${req.originalUrl} - ${req.ip} - ${new Date().toISOString()}`);
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusIcon = res.statusCode >= 400 ? '❌' : '✅';
    console.log(`${statusIcon} ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
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
