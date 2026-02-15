import Track from '../models/Track.js';

class SystemController {

  /**
   * Health check endpoint
   */
  async healthCheck(req, res) {
    try {
      // Check database connection
      await Track.findOne().limit(1);
      
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

  /**
   * Root endpoint
   */
  handleRoot(req, res) {
    const welcomeMessage = {
      message: 'Music Webhook Server',
      version: '1.0.0',
      framework: 'Express.js + Bun.js',
      features: [
        'Multiple webhook formats (Web Scrobbler, ListenBrainz, custom JSON)',
        'Duplicate prevention & Spotify enrichment queue',
        'In-memory Now Playing state with refresh endpoints',
        'ListenBrainz bulk import UI + API'
      ],
      endpoints: {
        webhook: {
          'POST /webhook/scrobble': 'Receive scrobble data from clients (Web Scrobbler, ListenBrainz import payloads)',
          'POST /webhook': 'Alternative scrobble endpoint'
        },
        nowPlaying: {
          'GET /api/nowplaying': 'Get current in-memory Now Playing snapshot',
          'POST /api/nowplaying/playing': 'Set or refresh Now Playing status (supports playing/paused/stopped)'
        },
        listeningData: {
        'GET /api/tracks?page=1&limit=50': 'List tracks with pagination/search',
        'PATCH /api/tracks': 'Update loved flag for a track (body: { id, isLoved })',
        'GET /api/tracks/top-artists?range=week': 'Top artists leaderboard',
        'GET /api/tracks/top-tracks?range=week': 'Top tracks leaderboard',
        'GET /api/track?artist=<name>&title=<title>': 'Single track analytics',
        'GET /api/albums?artist=<name>&album=<album>': 'Album analytics overview',
        'GET /api/artists/:name': 'Artist profile + timeline',
          'DELETE /api/tracks/range?start=<ISO>&end=<ISO>&dryRun=true': 'Delete tracks within a scrobbledAt date range (optional source/connector filters)',
          'GET /api/stats': 'Aggregate listening statistics',
          'GET /api/health': 'Health check endpoint'
        },
        import: {
          'GET /import/listenbrainz': 'ListenBrainz import UI (paste JSON/JSON Lines or upload file)',
          'POST /api/import/listenbrainz': 'Bulk import ListenBrainz JSON or JSON Lines payloads'
        },
        duplicates: {
          'GET /api/duplicates': 'Duplicate track statistics',
          'DELETE /api/duplicates?dryRun=true&details=true': 'Preview duplicate removal',
          'DELETE /api/duplicates': 'Remove duplicate tracks'
        },
        spotify: {
          'GET /api/spotify/status': 'Spotify integration status',
          'GET /api/spotify/stats': 'Spotify enrichment statistics',
          'POST /api/spotify/enrich?limit=10&force=true': 'Manual Spotify enrichment',
          'POST /api/spotify/update-missing?limit=50&missingOnly=true': 'Fill missing metadata using Spotify',
          'DELETE /api/spotify/cache': 'Clear Spotify search cache'
        }
      },
      notes: [
        'Use dryRun=true when deleting or deduplicating to preview the impact',
        'ListenBrainz imports automatically queue Spotify enrichment when configured',
        'Send POST requests to /webhook/scrobble with validated payloads to record new tracks'
      ]
    };

    res.status(200).json(welcomeMessage);
  }

  /**
   * Get duplicate statistics
   */
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

  /**
   * Find and remove duplicate tracks
   */
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

  /**
   * Delete tracks by date range
   */
  async deleteTracksByDateRange(req, res) {
    try {
      const { start, end, source, connector, dryRun } = req.query || {};

      if (!start || !end) {
        return res.status(400).json({
          success: false,
          error: 'Missing parameters',
          message: 'ต้องระบุ start และ end (รูปแบบ ISO date เช่น 2024-01-01T00:00:00Z)'
        });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date',
          message: 'ค่า start หรือ end ไม่ใช่วันที่ที่ถูกต้อง'
        });
      }

      if (endDate < startDate) {
        return res.status(400).json({
          success: false,
          error: 'Invalid range',
          message: 'end ต้องมากกว่าหรือเท่ากับ start'
        });
      }

      const filter = {
        scrobbledAt: {
          $gte: startDate,
          $lte: endDate
        }
      };

      if (source) {
        filter.source = source;
      }

      if (connector) {
        filter.connector = connector;
      }

      const totalMatches = await Track.countDocuments(filter);

      if (String(dryRun).toLowerCase() === 'true') {
        return res.status(200).json({
          success: true,
          message: 'Dry run: ไม่ได้ลบข้อมูล',
          matches: totalMatches,
          filter
        });
      }

      const result = await Track.deleteMany(filter);

      return res.status(200).json({
        success: true,
        message: `ลบข้อมูลสำเร็จ ${result.deletedCount} รายการ`,
        deletedCount: result.deletedCount,
        filter,
        requestedRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        totalMatchedBeforeDelete: totalMatches
      });
    } catch (error) {
      console.error('❌ Error deleting tracks by date:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal error',
        message: error?.message || 'เกิดข้อผิดพลาดระหว่างลบข้อมูล'
      });
    }
  }
}

export default new SystemController();
