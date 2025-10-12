// Debug middleware สำหรับ development

export const debugMiddleware = (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && process.env.DEBUG_WEBHOOKS === 'true') {
    console.log('🔍 Debug Info:');
    console.log('   Method:', req.method);
    console.log('   URL:', req.originalUrl);
    console.log('   Headers:', JSON.stringify(req.headers, null, 2));
    
    // Handle undefined body safely
    if (req.body !== undefined) {
      const bodyStr = JSON.stringify(req.body, null, 2);
      console.log('   Body preview:', bodyStr ? bodyStr.substring(0, 500) : 'Empty body');
    } else {
      console.log('   Body preview: [Body not parsed yet]');
    }
    
    console.log('   IP:', req.ip);
    console.log('   User-Agent:', req.headers['user-agent']);
    console.log('');
  }
  next();
};

// Webhook secret validation with better debugging
export const debugWebhookSecret = (req, res, next) => {
  const secret = req.headers['x-webhook-secret'] || 
                req.headers['authorization'] || 
                req.headers['webhook-secret'] ||
                req.query.secret;
                
  const expectedSecret = process.env.WEBHOOK_SECRET;
  
  console.log('🔐 Webhook Secret Debug:');
  console.log('   Expected secret:', expectedSecret);
  console.log('   Received in X-Webhook-Secret:', req.headers['x-webhook-secret']);
  console.log('   Received in Authorization:', req.headers['authorization']);
  console.log('   Received in Webhook-Secret:', req.headers['webhook-secret']);
  console.log('   Received in query param:', req.query.secret);
  console.log('   Final secret used:', secret);
  console.log('');
  
  if (!expectedSecret) {
    console.warn('⚠️ WEBHOOK_SECRET not set - allowing all requests');
    return next();
  }
  
  if (!secret || secret !== expectedSecret) {
    console.log('❌ Secret validation failed');
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing webhook secret',
      debug: process.env.NODE_ENV === 'development' ? {
        expectedSecret,
        receivedSecret: secret,
        availableHeaders: Object.keys(req.headers),
        note: 'In development, you can bypass this by setting WEBHOOK_SECRET to empty string'
      } : undefined
    });
  }
  
  console.log('✅ Secret validation passed');
  next();
};

// Temporary bypass for development
export const bypassSecretInDev = (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && process.env.BYPASS_WEBHOOK_SECRET === 'true') {
    console.log('🚫 Bypassing webhook secret validation in development mode');
    return next();
  }
  return debugWebhookSecret(req, res, next);
};

// Webhook-specific debug middleware
export const debugWebhookData = (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && process.env.DEBUG_WEBHOOKS === 'true' && req.originalUrl.includes('/webhook')) {
    console.log('🎵 Webhook Data Debug:');
    console.log('   Origin:', req.headers.origin || 'Unknown');
    console.log('   Content-Length:', req.headers['content-length'] || '0');
    
    if (req.body) {
      // Pretty print the body data (only if debug enabled)
      console.log('   Scrobble Data:');
      console.log(JSON.stringify(req.body, null, 4));
    }
    console.log('');
  } else if (process.env.NODE_ENV === 'development' && req.originalUrl.includes('/webhook')) {
    // Simple logging for production-like behavior
    if (req.body) {
      // Extract key info - support multiple formats
      let title, artist, connector, eventType;

      // Format 1: Web-scrobbler new format
      if (req.body.eventName && req.body.data && req.body.data.song) {
        const song = req.body.data.song;
        const trackData = song.parsed || song.processed || {};
        title = trackData.track;
        artist = trackData.artist;
        connector = song.connector ? song.connector.label || song.connector.id : 'Unknown';
        eventType = req.body.eventName;
      }
      // Format 2: Standard web-scrobbler format (track is an object)
      else if (req.body.track && typeof req.body.track === 'object') {
        title = req.body.track.title || req.body.track.name;
        artist = req.body.track.artist;
        connector = req.body.connector || req.body.source;
        eventType = 'track_object';
      } 
      // Format 3: Simple format (title/artist at root, or track is a string)
      else {
        title = req.body.title || req.body.track;
        artist = req.body.artist;
        connector = req.body.connector || req.body.source;
        eventType = 'simple';
      }
      
      console.log(`🎵 ${eventType || 'webhook'}: ${artist || 'N/A'} - ${title || 'N/A'} (${connector || 'Unknown'})`);
    }
  }
  next();
};

export default {
  debugMiddleware,
  debugWebhookSecret,
  bypassSecretInDev,
  debugWebhookData
};
