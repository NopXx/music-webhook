import Track from '../models/Track.js';
import spotifyService from '../services/spotifyService.js';
import nowPlayingService from '../services/nowPlayingService.js';

export class WebhookRoutes {
  constructor() {
    this.validateWebhookSecret = this.validateWebhookSecret.bind(this);
    this.handleScrobble = this.handleScrobble.bind(this);
    this.getStats = this.getStats.bind(this);
    this.getRecentTracks = this.getRecentTracks.bind(this);
    this.healthCheck = this.healthCheck.bind(this);
    this.enrichWithSpotifyData = this.enrichWithSpotifyData.bind(this);
    this.getSpotifyStatus = this.getSpotifyStatus.bind(this);
    this.getSpotifyStats = this.getSpotifyStats.bind(this);
    this.enrichTracksWithSpotify = this.enrichTracksWithSpotify.bind(this);
    this.clearSpotifyCache = this.clearSpotifyCache.bind(this);
    this.updateMissingSpotifyData = this.updateMissingSpotifyData.bind(this);
    this.getNowPlaying = this.getNowPlaying.bind(this);
    this.setNowPlaying = this.setNowPlaying.bind(this);
  }

  // Middleware to validate webhook secret
  validateWebhookSecret(req, res, next) {
    const secret = req.headers['x-webhook-secret'] || req.headers['authorization'];
    const expectedSecret = process.env.WEBHOOK_SECRET;
    
    if (!expectedSecret) {
      console.warn('⚠️ WEBHOOK_SECRET not set in environment variables');
      return next(); // Allow if no secret is configured
    }
    
    if (!secret || secret !== expectedSecret) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid or missing webhook secret'
      });
    }
    
    next();
  }

  // Handle incoming scrobble data
  async handleScrobble(req, res) {
    try {
      const body = req.body;
      const validatedTrack = req.validatedTrack; // From validation middleware
      
      // Create track data using validated information and metadata
      const trackData = this.parseScrobbleData(body, req, validatedTrack);

      // Update in-memory Now Playing status for any event
      try {
        nowPlayingService.updateFromEvent(trackData);
      } catch (npErr) {
        console.warn('⚠️ Failed to update Now Playing state:', npErr?.message || npErr);
      }
      
      // Use findOrCreateTrack to avoid duplicates
      const savedTrack = await Track.findOrCreateTrack(trackData);
      
      // ถ้าเป็น track ใหม่หรือ track ที่ยังไม่มีข้อมูล Spotify ให้ไปดึงข้อมูล
      const shouldEnrichWithSpotify = 
        (savedTrack.action === 'created' || 
        (savedTrack.action === 'updated' && !savedTrack.spotify_search_attempted)) ||
        (!savedTrack.spotify_search_attempted && savedTrack.eventType === 'scrobble');
        
      if (shouldEnrichWithSpotify && spotifyService.isConfigured()) {
        // ดึงข้อมูลจาก Spotify แบบ async (ไม่ให้ผู้ใช้รอ)
        // ใช้ setTimeout เพื่อให้ response ส่งกลับก่อน แล้วค่อย enrich
        setTimeout(() => {
          this.enrichWithSpotifyData(savedTrack).catch(error => {
            console.error(`❌ Failed to enrich track ${savedTrack._id} with Spotify data:`, error.message);
          });
        }, 100); // รอ 100ms ให้ response ออกไปก่อน
      }
      
      const message = savedTrack.action === 'created' ? 'Track saved successfully' :
                      savedTrack.action === 'updated' ? 'Track updated successfully' :
                      (savedTrack.action === 'ignored' && savedTrack.eventType !== 'scrobble') ? `Now playing status updated to ${savedTrack.eventType}` :
                      'Track already exists';

      res.status(200).json({ 
        success: true, 
        message: message,
        trackId: savedTrack._id,
        action: savedTrack.action,
        spotify_configured: spotifyService.isConfigured(),
        spotify_enrichment_queued: shouldEnrichWithSpotify,
        now_playing: nowPlayingService.getStatus(),
        track: {
          artist: savedTrack.artist,
          title: savedTrack.title,
          album: savedTrack.album,
          duration: savedTrack.duration,
          connector: savedTrack.connector,
          eventType: savedTrack.eventType,
          userPlayCount: savedTrack.userPlayCount,
          timestamp: savedTrack.timestamp,
          spotify_enriched: savedTrack.spotify_enriched,
          spotify_data: savedTrack.spotify_enriched ? {
            spotify_id: savedTrack.spotify?.id,
            spotify_url: savedTrack.spotify?.url,
            album_art: savedTrack.spotify?.album?.images?.[0]?.url
          } : null
        }
      });

    } catch (error) {
      console.error('❌ Error processing scrobble:', error.message);
      
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  }

  // Get current Now Playing status (in-memory)
  async getNowPlaying(req, res) {
    try {
      const status = nowPlayingService.getStatus();
      res.status(200).json({
        message: 'Current now playing status',
        ...status,
      });
    } catch (error) {
      console.error('❌ Error getting now playing status:', error);
      res.status(500).json({
        error: 'Failed to get now playing status',
        message: error.message,
      });
    }
  }

  // Manually update/refresh playing status
  async setNowPlaying(req, res) {
    try {
      const { track, currentTime, duration } = req.body || {};
      const status = (req.body && req.body.status) ? req.body.status : 'playing';

      if (status === 'playing') {
        if (track && (track.title && track.artist)) {
          // Force set with track details if provided
          nowPlayingService.forcePlaying({
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: typeof duration === 'number' ? duration : track.duration,
            connector: track.connector,
            originalUrl: track.originalUrl,
            trackArtUrl: track.trackArtUrl,
            artistUrl: track.artistUrl,
            trackUrl: track.trackUrl,
            albumUrl: track.albumUrl,
            currentTime: typeof currentTime === 'number' ? currentTime : undefined,
          });
        } else {
          // Refresh existing playing state
          nowPlayingService.refreshPlaying({
            currentTime: typeof currentTime === 'number' ? currentTime : null,
            duration: typeof duration === 'number' ? duration : null,
          });
        }
      } else if (status === 'paused') {
        nowPlayingService.setPaused({
          ...(track || {}),
          currentTime: typeof currentTime === 'number' ? currentTime : undefined,
          duration: typeof duration === 'number' ? duration : (track?.duration ?? undefined),
        });
      } else if (status === 'stopped') {
        nowPlayingService.setStopped(track || {});
      } else {
        return res.status(400).json({
          error: 'Invalid status',
          message: 'status must be one of: playing, paused, stopped'
        });
      }

      return res.status(200).json({
        message: 'Now playing status updated',
        ...nowPlayingService.getStatus(),
      });
    } catch (error) {
      console.error('❌ Error setting now playing status:', error);
      res.status(500).json({
        error: 'Failed to set now playing status',
        message: error.message,
      });
    }
  }

  // Parse scrobble data from various formats
  parseScrobbleData(body, req, validatedTrack = null) {
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

    // Use validated track data if available
    if (validatedTrack) {
      // Extract metadata from web-scrobbler new format
      let metadata = {};
      let flags = {};
      
      if (body.eventName && body.data && body.data.song) {
        const song = body.data.song;
        
        // Extract metadata
        if (song.metadata) {
          metadata = {
            userPlayCount: song.metadata.userPlayCount || null,
            trackArtUrl: song.metadata.trackArtUrl || null,
            artistUrl: song.metadata.artistUrl || null,
            trackUrl: song.metadata.trackUrl || null,
            albumUrl: song.metadata.albumUrl || null,
            isLovedInService: song.metadata.userloved || false,
            startTimestamp: song.metadata.startTimestamp ? new Date(song.metadata.startTimestamp * 1000) : null,
          };
        }
        
        // Extract flags
        if (song.flags) {
          flags = {
            isScrobbled: song.flags.isScrobbled || false,
            isCorrectedByUser: song.flags.isCorrectedByUser || false,
            isValid: song.flags.isValid !== false, // Default to true
          };
        }
        
        // Extract timing info
        const trackData = song.parsed || song.processed || {};
        metadata.currentTime = trackData.currentTime || null;
      }
      
      return {
        title: validatedTrack.title,
        artist: validatedTrack.artist,
        album: validatedTrack.album || '',
        albumArtist: '',
        genre: '',
        year: null,
        trackNumber: null,
        duration: validatedTrack.duration,
        timestamp: validatedTrack.timestamp ? new Date(validatedTrack.timestamp) : new Date(),
        source: 'web-scrobbler',
        connector: validatedTrack.connector,
        originalUrl: validatedTrack.originalUrl,
        
        // Metadata from web-scrobbler
        ...metadata,
        ...flags,
        
        // Event information
        eventType: validatedTrack.eventName || 'unknown',
        
        // Technical info
        userAgent,
        ipAddress,
        rawData: {
          ...body,
          format: validatedTrack.rawFormat,
          eventName: validatedTrack.eventName
        }
      };
    }

    // Fallback to legacy parsing (for backward compatibility)
    console.log('⚠️ Using legacy parsing method');
    
    // ... rest of legacy code remains the same
    return this.legacyParseScrobbleData(body, req, userAgent, ipAddress);
  }
  
  // Legacy parsing method for backward compatibility
  legacyParseScrobbleData(body, req, userAgent, ipAddress) {
    // Default track data structure
    let trackData = {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      genre: '',
      year: null,
      trackNumber: null,
      duration: null,
      timestamp: new Date(),
      source: 'web-scrobbler',
      connector: '',
      originalUrl: '',
      eventType: 'unknown',
      userAgent,
      ipAddress,
      rawData: body
    };

    // Handle different web-scrobbler formats (legacy support)
    if (body.eventName && body.data && body.data.song) {
      // New web-scrobbler format
      const song = body.data.song;
      const trackInfo = song.parsed || song.processed || song.noRegex || {};
      
      trackData = {
        ...trackData,
        title: trackInfo.track || '',
        artist: trackInfo.artist || '',
        album: trackInfo.album || '',
        duration: trackInfo.duration || null,
        connector: song.connector ? (song.connector.label || song.connector.id) : '',
        originalUrl: trackInfo.originUrl || '',
        timestamp: body.time ? new Date(body.time) : new Date(),
        eventType: body.eventName || 'unknown',
      };
    } else if (body.track) {
      // Standard web-scrobbler format
      const track = body.track;
      trackData = {
        ...trackData,
        title: track.title || track.name || '',
        artist: track.artist || '',
        album: track.album || '',
        albumArtist: track.albumArtist || track.album_artist || '',
        duration: track.duration || track.length || null,
        connector: body.connector || body.source || '',
        originalUrl: track.url || body.url || '',
        timestamp: track.timestamp ? new Date(track.timestamp * 1000) : new Date(),
      };
    } else if (body.artist && body.title) {
      // Simple format
      trackData = {
        ...trackData,
        title: body.title,
        artist: body.artist,
        album: body.album || '',
        duration: body.duration || null,
        connector: body.connector || body.source || '',
        originalUrl: body.url || '',
        timestamp: body.timestamp ? new Date(body.timestamp * 1000) : new Date(),
      };
    } else if (body.nowPlaying) {
      // Now playing format
      const np = body.nowPlaying;
      trackData = {
        ...trackData,
        title: np.title || np.track || '',
        artist: np.artist || '',
        album: np.album || '',
        duration: np.duration || null,
        connector: body.source || 'web-scrobbler',
        originalUrl: np.url || '',
        eventType: 'nowplaying',
      };
    }

    // Clean up and validate required fields
    if (!trackData.title || !trackData.artist) {
      throw new Error('Missing required fields: title and artist');
    }

    return trackData;
  }

  // Get statistics
  async getStats(req, res) {
    try {
      const totalTracks = await Track.countDocuments();
      const topArtists = await Track.getTopArtists(10);
      const recentActivity = await Track.find()
        .sort({ scrobbledAt: -1 })
        .limit(5)
        .select('artist title scrobbledAt source connector spotify_enriched');

      // Get Spotify statistics
      let spotifyStats = null;
      if (spotifyService.isConfigured()) {
        try {
          const spotifyData = await Track.getSpotifyStats();
          const stats = spotifyData[0] || {
            total: 0,
            spotify_enriched: 0,
            spotify_search_attempted: 0,
            spotify_match_found: 0
          };
          
          spotifyStats = {
            ...stats,
            enrichment_rate: stats.total > 0 ? 
              Math.round((stats.spotify_enriched / stats.total) * 100) : 0,
            match_rate: stats.spotify_search_attempted > 0 ? 
              Math.round((stats.spotify_match_found / stats.spotify_search_attempted) * 100) : 0,
            pending: stats.total - stats.spotify_search_attempted,
            configured: true
          };
        } catch (error) {
          console.error('⚠️ Error getting Spotify stats in main stats:', error.message);
          spotifyStats = { configured: true, error: 'Failed to fetch Spotify statistics' };
        }
      } else {
        spotifyStats = { configured: false, message: 'Spotify integration not configured' };
      }

      const stats = {
        totalTracks,
        topArtists,
        recentActivity,
        lastScrobble: recentActivity[0]?.scrobbledAt || null,
        spotify: spotifyStats
      };

      res.status(200).json(stats);

    } catch (error) {
      console.error('❌ Error getting stats:', error);
      
      res.status(500).json({ 
        error: 'Failed to get statistics',
        message: error.message 
      });
    }
  }

  // Get recent tracks
  async getRecentTracks(req, res) {
    try {
      const limit = parseInt(req.query.limit || '50');
      const offset = parseInt(req.query.offset || '0');

      const tracks = await Track.find()
        .sort({ scrobbledAt: -1 })
        .skip(offset)
        .limit(Math.min(limit, 100)) // Max 100 per request
        .select('title artist album scrobbledAt source connector duration');

      const total = await Track.countDocuments();

      res.status(200).json({
        tracks,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total
        }
      });

    } catch (error) {
      console.error('❌ Error getting recent tracks:', error);
      
      res.status(500).json({ 
        error: 'Failed to get recent tracks',
        message: error.message 
      });
    }
  }

  // Health check endpoint
  async healthCheck(req, res) {
    try {
      // Check database connection
      const dbStatus = await Track.findOne().limit(1);
      
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        version: '1.0.0',
        uptime: process.uptime()
      });

    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error.message
      });
    }
  }

  // Find and remove duplicate tracks
  async removeDuplicates(req, res) {
    try {
      const dryRun = req.query.dryRun === 'true';
      
      // Find duplicates: same artist, title, connector within 5 minutes
      const duplicates = await Track.aggregate([
        {
          $group: {
            _id: {
              artist: '$artist',
              title: '$title',
              connector: '$connector',
              // Group by 5-minute time windows
              timeWindow: {
                $floor: {
                  $divide: [{ $toLong: '$scrobbledAt' }, 300000] // 5 minutes
                }
              }
            },
            tracks: { $push: '$ROOT' },
            count: { $sum: 1 }
          }
        },
        {
          $match: { count: { $gt: 1 } }
        },
        {
          $sort: { '_id.timeWindow': -1 }
        }
      ]);
      
      let removedCount = 0;
      const duplicateGroups = [];
      
      for (const group of duplicates) {
        const tracks = group.tracks.sort((a, b) => new Date(b.scrobbledAt) - new Date(a.scrobbledAt));
        const keepTrack = tracks[0]; // Keep the most recent one
        const removeTrackIds = tracks.slice(1).map(t => t._id);
        
        duplicateGroups.push({
          artist: group._id.artist,
          title: group._id.title,
          connector: group._id.connector,
          totalCount: tracks.length,
          keepTrackId: keepTrack._id,
          removeTrackIds,
          keepTrackDate: keepTrack.scrobbledAt
        });
        
        if (!dryRun && removeTrackIds.length > 0) {
          await Track.deleteMany({ _id: { $in: removeTrackIds } });
          removedCount += removeTrackIds.length;
        } else {
          removedCount += removeTrackIds.length;
        }
      }
      
      res.status(200).json({
        success: true,
        dryRun,
        duplicateGroups: duplicateGroups.length,
        tracksToRemove: removedCount,
        duplicates: req.query.details === 'true' ? duplicateGroups : undefined,
        message: dryRun ? 
          `Found ${removedCount} duplicate tracks that would be removed` :
          `Removed ${removedCount} duplicate tracks`
      });
      
    } catch (error) {
      console.error('❌ Error removing duplicates:', error);
      
      res.status(500).json({
        error: 'Failed to remove duplicates',
        message: error.message
      });
    }
  }

  // Get duplicate statistics
  async getDuplicateStats(req, res) {
    try {
      const duplicateStats = await Track.aggregate([
        {
          $group: {
            _id: {
              artist: '$artist',
              title: '$title',
              connector: '$connector'
            },
            count: { $sum: 1 },
            tracks: { $push: { id: '$_id', scrobbledAt: '$scrobbledAt', eventType: '$eventType' } }
          }
        },
        {
          $match: { count: { $gt: 1 } }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 20
        }
      ]);
      
      const totalDuplicates = await Track.aggregate([
        {
          $group: {
            _id: {
              artist: '$artist',
              title: '$title',
              connector: '$connector'
            },
            count: { $sum: 1 }
          }
        },
        {
          $match: { count: { $gt: 1 } }
        },
        {
          $group: {
            _id: null,
            totalDuplicateGroups: { $sum: 1 },
            totalDuplicateTracks: { $sum: { $subtract: ['$count', 1] } }
          }
        }
      ]);
      
      res.status(200).json({
        duplicateGroups: duplicateStats.length,
        totalStats: totalDuplicates[0] || { totalDuplicateGroups: 0, totalDuplicateTracks: 0 },
        topDuplicates: duplicateStats,
        endpoints: {
          removeDuplicates: 'DELETE /api/duplicates?dryRun=true',
          removeDuplicatesForReal: 'DELETE /api/duplicates'
        }
      });
      
    } catch (error) {
      console.error('❌ Error getting duplicate stats:', error);
      
      res.status(500).json({
        error: 'Failed to get duplicate statistics',
        message: error.message
      });
    }
  }

  // Enrich track with Spotify data
  async enrichWithSpotifyData(track) {
    try {
      console.log(`🎵 Searching Spotify for: ${track.artist} - ${track.title}`);
      
      // Search for track on Spotify
      const spotifyData = await spotifyService.searchTrack(track.artist, track.title);
      
      if (spotifyData) {
        // เก็บข้อมูลเดิมเพื่อเปรียบเทียบ
        const originalData = {
          duration: track.duration,
          album: track.album,
          year: track.year,
          trackNumber: track.trackNumber
        };
        
        console.log(`✨ Found Spotify match for: ${track.artist} - ${track.title}`);
        console.log(`   Spotify ID: ${spotifyData.spotify_id}`);
        console.log(`   Album: ${spotifyData.album?.name || 'N/A'}`);
        console.log(`   Release Year: ${spotifyData.album?.release_date ? new Date(spotifyData.album.release_date).getFullYear() : 'N/A'}`);
        
        // สร้าง update object แทนการใช้ track.setSpotifyData
        const updateData = {
          spotify: {
            id: spotifyData.spotify_id,
            uri: spotifyData.spotify_uri,
            url: spotifyData.spotify_url,
            popularity: spotifyData.popularity,
            preview_url: spotifyData.preview_url,
            duration_ms: spotifyData.duration_ms,
            explicit: spotifyData.explicit,
            track_number: spotifyData.track_number,
            disc_number: spotifyData.disc_number,
            is_local: spotifyData.is_local,
            artist: spotifyData.artist,
            all_artists: spotifyData.all_artists,
            album: spotifyData.album,
            search_confidence: 1.0,
            fetched_at: new Date()
          },
          spotify_enriched: true,
          spotify_search_attempted: true,
          spotify_match_found: true
        };
        
        // เติมข้อมูลพื้นฐานที่ขาดหายไป
        const enrichedFields = [];
        
        if (spotifyData.duration_seconds && (!originalData.duration || originalData.duration === null)) {
          updateData.duration = spotifyData.duration_seconds;
          enrichedFields.push('duration');
          console.log(`🔧 Adding duration: ${spotifyData.duration_seconds}s`);
        }
        
        if (spotifyData.album?.name && (!originalData.album || originalData.album.trim() === '')) {
          updateData.album = spotifyData.album.name;
          enrichedFields.push('album');
          console.log(`🔧 Adding album: ${spotifyData.album.name}`);
        }
        
        if (spotifyData.album?.release_date && (!originalData.year || originalData.year === null)) {
          const releaseYear = new Date(spotifyData.album.release_date).getFullYear();
          if (!isNaN(releaseYear)) {
            updateData.year = releaseYear;
            enrichedFields.push('year');
            console.log(`🔧 Adding year: ${releaseYear}`);
          }
        }
        
        if (spotifyData.track_number && (!originalData.trackNumber || originalData.trackNumber === null)) {
          updateData.trackNumber = spotifyData.track_number;
          enrichedFields.push('trackNumber');
          console.log(`🔧 Adding track number: ${spotifyData.track_number}`);
        }
        
        // Optionally get audio features
        if (process.env.SPOTIFY_FETCH_AUDIO_FEATURES === 'true') {
          const audioFeatures = await spotifyService.getAudioFeatures(spotifyData.spotify_id);
          if (audioFeatures) {
            updateData['spotify.audio_features'] = audioFeatures;
            console.log(`🎧 Adding audio features`);
          }
        }
        
        // ใช้ findByIdAndUpdate เพื่อป้องกัน race condition
        const updatedTrack = await Track.findByIdAndUpdate(
          track._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );
        
        if (updatedTrack) {
          console.log(`✅ Spotify enrichment completed for: ${track.artist} - ${track.title}`);
          if (enrichedFields.length > 0) {
            console.log(`   Added fields: ${enrichedFields.join(', ')}`);
          } else {
            console.log(`   No missing fields to add (track data was already complete)`);
          }
        } else {
          console.log(`⚠️ Track not found during update: ${track._id}`);
        }
        
      } else {
        // Mark as searched but no match found
        await Track.findByIdAndUpdate(
          track._id,
          { 
            $set: {
              spotify_search_attempted: true,
              spotify_match_found: false,
              spotify_enriched: false
            }
          }
        );
        console.log(`❌ No Spotify match found for: ${track.artist} - ${track.title}`);
      }
      
    } catch (error) {
      console.error(`❌ Error enriching track ${track._id} with Spotify:`, error.message);
      
      // Mark as searched even if error occurred
      try {
        await Track.findByIdAndUpdate(
          track._id,
          { 
            $set: {
              spotify_search_attempted: true,
              spotify_match_found: false,
              spotify_enriched: false
            }
          }
        );
      } catch (saveError) {
        // ถ้า track ถูกลบไปแล้วหรือมี error อื่น ก็ไม่ต้องทำอะไร
        if (saveError.message.includes('Cast to ObjectId failed')) {
          console.log(`⚠️ Track ${track._id} no longer exists`);
        } else {
          console.error(`❌ Error saving search attempt status:`, saveError.message);
        }
      }
    }
  }

  // Update missing Spotify data for existing tracks
  async updateMissingSpotifyData(req, res) {
    try {
      if (!spotifyService.isConfigured()) {
        return res.status(400).json({
          error: 'Spotify not configured',
          message: 'Please configure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET'
        });
      }

      const limit = Math.min(parseInt(req.query.limit || '50'), 100); // Max 100 at a time
      const onlyMissingBasicData = req.query.missingOnly === 'true'; // เฉพาะที่ขาดข้อมูลพื้นฐาน
      const forceUpdate = req.query.force === 'true'; // บังคับ update ทั้งหมด
      const priorityFields = req.query.priority || 'duration,album,year'; // fields ที่ต้องการให้ priority
      
      console.log(`🔄 Starting Spotify data update for existing tracks...`);
      console.log(`   Limit: ${limit}`);
      console.log(`   Missing data only: ${onlyMissingBasicData}`);
      console.log(`   Force update: ${forceUpdate}`);
      console.log(`   Priority fields: ${priorityFields}`);

      // Query สำหรับหา tracks ที่ต้องการ update
      let query = {};
      
      if (forceUpdate) {
        // Force mode: ทุก track ที่เป็น scrobble
        query = { eventType: 'scrobble' };
      } else if (onlyMissingBasicData) {
        // เฉพาะ tracks ที่ขาดข้อมูลพื้นฐาน
        const priorityFieldsArray = priorityFields.split(',');
        const orConditions = [];
        
        if (priorityFieldsArray.includes('duration')) {
          orConditions.push({ $or: [{ duration: null }, { duration: { $exists: false } }] });
        }
        if (priorityFieldsArray.includes('album')) {
          orConditions.push({ $or: [{ album: null }, { album: "" }, { album: { $exists: false } }] });
        }
        if (priorityFieldsArray.includes('year')) {
          orConditions.push({ $or: [{ year: null }, { year: { $exists: false } }] });
        }
        
        query = {
          eventType: 'scrobble',
          $and: [
            { $or: orConditions },
            { spotify_search_attempted: { $ne: true } } // ยังไม่เคยค้นหา Spotify
          ]
        };
      } else {
        // Default: tracks ที่ยังไม่ได้ search Spotify
        query = {
          eventType: 'scrobble',
          spotify_search_attempted: { $ne: true }
        };
      }

      // หา tracks ที่ต้อง update
      const tracksToUpdate = await Track.find(query)
        .sort({ scrobbledAt: -1 })
        .limit(limit)
        .select('_id artist title album duration year trackNumber spotify_search_attempted spotify_enriched');

      if (tracksToUpdate.length === 0) {
        return res.status(200).json({
          message: 'No tracks need Spotify data update',
          query_type: onlyMissingBasicData ? 'missing_basic_data' : 'no_spotify_data',
          processed: 0
        });
      }

      console.log(`🎵 Found ${tracksToUpdate.length} tracks that need Spotify data update`);

      // Statistics tracking
      let stats = {
        processed: 0,
        enriched: 0,
        no_match: 0,
        errors: 0,
        fields_updated: {
          duration: 0,
          album: 0,
          year: 0,
          trackNumber: 0
        }
      };

      // Process tracks with rate limiting
      for (let i = 0; i < tracksToUpdate.length; i++) {
        const track = tracksToUpdate[i];
        
        try {
          console.log(`🔍 [${i + 1}/${tracksToUpdate.length}] Processing: ${track.artist} - ${track.title}`);
          
          // เก็บข้อมูลก่อน update เพื่อเปรียบเทียบ
          const beforeUpdate = {
            duration: track.duration,
            album: track.album,
            year: track.year,
            trackNumber: track.trackNumber
          };
          
          await this.enrichWithSpotifyData(track);
          
          // ตรวจสอบข้อมูลหลัง update
          const updatedTrack = await Track.findById(track._id);
          
          if (updatedTrack && updatedTrack.spotify_enriched) {
            stats.enriched++;
            
            // ตรวจสอบว่า field ไหนถูก update
            if (beforeUpdate.duration !== updatedTrack.duration && updatedTrack.duration) {
              stats.fields_updated.duration++;
            }
            if (beforeUpdate.album !== updatedTrack.album && updatedTrack.album) {
              stats.fields_updated.album++;
            }
            if (beforeUpdate.year !== updatedTrack.year && updatedTrack.year) {
              stats.fields_updated.year++;
            }
            if (beforeUpdate.trackNumber !== updatedTrack.trackNumber && updatedTrack.trackNumber) {
              stats.fields_updated.trackNumber++;
            }
            
            console.log(`✅ Successfully enriched: ${track.artist} - ${track.title}`);
          } else {
            stats.no_match++;
            console.log(`❌ No Spotify match: ${track.artist} - ${track.title}`);
          }
          
          stats.processed++;
          
          // Rate limiting delay
          if (i < tracksToUpdate.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
          }
          
        } catch (error) {
          stats.errors++;
          console.error(`❌ Error processing track ${track._id}: ${error.message}`);
        }
      }

      const message = [
        `Processed ${stats.processed} tracks`,
        `Successfully enriched: ${stats.enriched}`,
        `No match found: ${stats.no_match}`,
        `Errors: ${stats.errors}`
      ].join(', ');

      console.log(`🎉 Spotify update completed: ${message}`);

      res.status(200).json({
        success: true,
        message: 'Spotify data update completed',
        ...stats,
        updated_fields_summary: Object.entries(stats.fields_updated)
          .filter(([key, count]) => count > 0)
          .map(([key, count]) => `${key}: ${count}`)
          .join(', ') || 'No new fields added',
        query_options: {
          limit,
          missing_data_only: onlyMissingBasicData,
          force_update: forceUpdate,
          priority_fields: priorityFields
        }
      });
      
    } catch (error) {
      console.error('❌ Error in updateMissingSpotifyData:', error);
      res.status(500).json({
        error: 'Failed to update Spotify data',
        message: error.message
      });
    }
  }

  // Spotify integration endpoints
  async getSpotifyStatus(req, res) {
    try {
      const isConfigured = spotifyService.isConfigured();
      const cacheStats = spotifyService.getCacheStats();
      
      res.status(200).json({
        configured: isConfigured,
        client_id_set: !!process.env.SPOTIFY_CLIENT_ID,
        client_secret_set: !!process.env.SPOTIFY_CLIENT_SECRET,
        audio_features_enabled: process.env.SPOTIFY_FETCH_AUDIO_FEATURES === 'true',
        cache: cacheStats,
        message: isConfigured ? 
          'Spotify integration is configured and ready' : 
          'Spotify integration is not configured. Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET'
      });
    } catch (error) {
      console.error('❌ Error getting Spotify status:', error);
      res.status(500).json({
        error: 'Failed to get Spotify status',
        message: error.message
      });
    }
  }

  async getSpotifyStats(req, res) {
    try {
      const spotifyStats = await Track.getSpotifyStats();
      const stats = spotifyStats[0] || {
        total: 0,
        spotify_enriched: 0,
        spotify_search_attempted: 0,
        spotify_match_found: 0
      };
      
      // Calculate percentages
      const enrichmentRate = stats.total > 0 ? 
        Math.round((stats.spotify_enriched / stats.total) * 100) : 0;
      const matchRate = stats.spotify_search_attempted > 0 ? 
        Math.round((stats.spotify_match_found / stats.spotify_search_attempted) * 100) : 0;
      
      res.status(200).json({
        ...stats,
        enrichment_rate_percent: enrichmentRate,
        match_rate_percent: matchRate,
        pending_enrichment: stats.total - stats.spotify_search_attempted,
        cache_stats: spotifyService.getCacheStats()
      });
    } catch (error) {
      console.error('❌ Error getting Spotify stats:', error);
      res.status(500).json({
        error: 'Failed to get Spotify statistics',
        message: error.message
      });
    }
  }

  async enrichTracksWithSpotify(req, res) {
    try {
      if (!spotifyService.isConfigured()) {
        return res.status(400).json({
          error: 'Spotify not configured',
          message: 'Please configure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET'
        });
      }
      
      const limit = Math.min(parseInt(req.query.limit || '10'), 50); // Max 50 at a time
      const force = req.query.force === 'true'; // Force re-enrichment
      
      // Find tracks that need Spotify data
      let tracksToEnrich;
      if (force) {
        tracksToEnrich = await Track.find({ eventType: 'scrobble' })
          .sort({ scrobbledAt: -1 })
          .limit(limit);
      } else {
        tracksToEnrich = await Track.findWithoutSpotifyData(limit);
      }
      
      if (tracksToEnrich.length === 0) {
        return res.status(200).json({
          message: 'No tracks need Spotify enrichment',
          processed: 0
        });
      }
      
      console.log(`🎵 Starting Spotify enrichment for ${tracksToEnrich.length} tracks...`);
      
      // Process tracks (with small delay to avoid rate limiting)
      let enriched = 0;
      let errors = 0;
      
      for (const track of tracksToEnrich) {
        try {
          await this.enrichWithSpotifyData(track);
          enriched++;
          
          // Small delay to avoid overwhelming Spotify API
          if (enriched < tracksToEnrich.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error(`❌ Failed to enrich track ${track._id}:`, error.message);
          errors++;
        }
      }
      
      console.log(`✅ Spotify enrichment complete: ${enriched} enriched, ${errors} errors`);
      
      res.status(200).json({
        message: 'Spotify enrichment completed',
        processed: tracksToEnrich.length,
        enriched,
        errors,
        force_mode: force
      });
      
    } catch (error) {
      console.error('❌ Error in manual Spotify enrichment:', error);
      res.status(500).json({
        error: 'Failed to enrich tracks',
        message: error.message
      });
    }
  }

  async clearSpotifyCache(req, res) {
    try {
      const cacheStatsBefore = spotifyService.getCacheStats();
      spotifyService.clearCache();
      
      res.status(200).json({
        message: 'Spotify cache cleared',
        cleared_entries: cacheStatsBefore.size
      });
    } catch (error) {
      console.error('❌ Error clearing Spotify cache:', error);
      res.status(500).json({
        error: 'Failed to clear cache',
        message: error.message
      });
    }
  }

  // Root endpoint with API documentation
  handleRoot(req, res) {
    const welcomeMessage = {
      message: 'Music Webhook Server',
      version: '1.0.0',
      framework: 'Express.js + Bun.js',
      features: [
        'Duplicate prevention',
        'Metadata storage',
        'Multiple webhook formats',
        'Duplicate management'
      ],
      endpoints: {
        webhook: {
          'POST /webhook/scrobble': 'Receive scrobble data from web-scrobbler',
          'POST /webhook': 'Alternative scrobble endpoint'
        },
        api: {
          'GET /api/stats': 'Get scrobbling statistics',
          'GET /api/tracks': 'Get recent tracks (supports ?limit=50&offset=0)',
          'GET /api/nowplaying': 'Get current now playing status',
          'POST /api/nowplaying/playing': 'Set or refresh now playing status',
          'GET /api/health': 'Health check endpoint',
          'GET /api/duplicates': 'Get duplicate track statistics',
          'DELETE /api/duplicates': 'Remove duplicate tracks (?dryRun=true for preview)'
        },
        spotify: {
          'GET /api/spotify/status': 'Get Spotify integration status',
          'GET /api/spotify/stats': 'Get Spotify enrichment statistics',
          'POST /api/spotify/enrich': 'Manually enrich tracks with Spotify data (?limit=10&force=true)',
          'POST /api/spotify/update-missing': 'Update missing Spotify data for existing tracks (?limit=50&missingOnly=true&priority=duration,album,year)',
          'DELETE /api/spotify/cache': 'Clear Spotify search cache'
        }
      },
      duplicateManagement: {
        checkDuplicates: 'GET /api/duplicates',
        previewRemoval: 'DELETE /api/duplicates?dryRun=true&details=true',
        removeDuplicates: 'DELETE /api/duplicates'
      },
      documentation: 'Send POST requests to /webhook/scrobble with track data. Duplicates are automatically handled.'
    };

    res.status(200).json(welcomeMessage);
  }
}

export default new WebhookRoutes();
