import Scrobble from '../models/Scrobble.js';
import Artist from '../models/Artist.js';
import Album from '../models/Album.js';
import TrackMeta from '../models/TrackMeta.js';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildNormalizedTrackData, cleanAlbumName } from '../utils/trackNormalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SystemController {

  /**
   * Health check endpoint
   */
  async healthCheck(req, res) {
    try {
      // Check database connection
      await Scrobble.findOne().limit(1);
      
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        version: '1.0.2',
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
      version: '1.0.2',
      framework: 'Express.js + Bun.js',
      features: [
        'Multiple webhook formats (Web Scrobbler, ListenBrainz, custom JSON)',
        'Duplicate prevention & Spotify enrichment queue',
        'In-memory Now Playing state with refresh endpoints',
        'ListenBrainz bulk import UI + API',
        'Data migration from legacy tracks collection to normalized schema'
      ],
      endpoints: {
        info: {
          'GET /': 'This welcome message',
          'GET /api': 'Dynamic JSON listing of all API endpoints',
          'GET /health': 'Health check (alias of /api/health)'
        },
        webhook: {
          'POST /webhook/scrobble': 'Receive scrobble data from clients (Web Scrobbler, ListenBrainz import payloads) — supports event types: scrobble, nowplaying, paused, stopped',
          'POST /webhook': 'Alternative scrobble endpoint'
        },
        nowPlaying: {
          'GET /api/nowplaying': 'Get current in-memory Now Playing snapshot (supports ETag/304)',
          'POST /api/nowplaying/playing': 'Set Now Playing status — body: { state: "playing"|"paused"|"stopped", track: { title, artist, ... } }'
        },
        listeningData: {
          'GET /api/stats': 'Aggregate listening statistics',
          'GET /api/tracks?page=1&limit=50': 'List tracks with pagination/search (params: search, searchTitle, searchArtist, searchAlbum, connector, source, range, rangeOffset)',
          'PATCH /api/tracks': 'Update loved flag for a track (body: { id, isLoved })',
          'GET /api/tracks/top-artists?range=week': 'Top artists leaderboard',
          'GET /api/tracks/top-tracks?range=week': 'Top tracks leaderboard',
          'GET /api/track?artist=<name>&title=<title>': 'Single track analytics',
          'GET /api/albums?artist=<name>&album=<album>': 'Album analytics overview',
          'GET /api/artists/:name': 'Artist profile + timeline',
          'DELETE /api/tracks/range?start=<ISO>&end=<ISO>&dryRun=true': 'Delete tracks within a scrobbledAt date range (optional source/connector filters)',
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
          'POST /api/spotify/enrich?limit=10&force=true': 'Manual Spotify enrichment (max 50, force to re-enrich all)',
          'POST /api/spotify/update-missing?limit=50&missingOnly=true': 'Fill missing metadata using Spotify (params: limit, missingOnly, force, priority)',
          'DELETE /api/spotify/cache': 'Clear Spotify search cache'
        },
        migration: {
          'GET /migrate': 'Migration UI page',
          'GET /inspect': 'Track inspection UI page',
          'GET /api/migrate/precheck': 'Count documents in old vs new collections',
          'POST /api/migrate/run': 'Run migration (streaming NDJSON) — body: { dryRun: boolean }'
        }
      },
      notes: [
        'Use dryRun=true when deleting or deduplicating to preview the impact',
        'ListenBrainz imports automatically queue Spotify enrichment when configured',
        'Send POST requests to /webhook/scrobble with validated payloads to record new tracks',
        'Webhook supports nowplaying/paused/stopped events — these update in-memory state without creating scrobbles'
      ]
    };

    res.status(200).json(welcomeMessage);
  }

  /**
   * Get duplicate statistics
   */
  async getDuplicateStats(req, res) {
    try {
      const duplicateStats = await Scrobble.aggregate([
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
          $group: {
            _id: {
              artist: '$artistInfo.name',
              title: '$trackInfo.title',
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
      
      const totalDuplicates = await Scrobble.aggregate([
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
          $group: {
            _id: {
              artist: '$artistInfo.name',
              title: '$trackInfo.title',
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
      const duplicates = await Scrobble.aggregate([
        {
          $group: {
            _id: {
              track: '$track',
              connector: '$connector',
              timeWindow: {
                $floor: {
                  $divide: [{ $toLong: '$scrobbledAt' }, 300000]
                }
              }
            },
            tracks: { $push: '$$ROOT' },
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
          trackId: group._id.track,
          connector: group._id.connector,
          totalCount: tracks.length,
          keepTrackId: keepTrack._id,
          removeTrackIds,
          keepTrackDate: keepTrack.scrobbledAt
        });
        
        if (!dryRun && removeTrackIds.length > 0) {
          await Scrobble.deleteMany({ _id: { $in: removeTrackIds } });
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

      const totalMatches = await Scrobble.countDocuments(filter);

      if (String(dryRun).toLowerCase() === 'true') {
        return res.status(200).json({
          success: true,
          message: 'Dry run: ไม่ได้ลบข้อมูล',
          matches: totalMatches,
          filter
        });
      }

      const result = await Scrobble.deleteMany(filter);

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

  // ──────────────────────────────────────────────
  // Migration endpoints
  // ──────────────────────────────────────────────

  /**
   * Render the migration UI page.
   */
  renderMigratePage(req, res) {
    res.sendFile(path.join(__dirname, '../views/migrate.html'));
  }

  /**
   * Render the track inspection UI page.
   */
  renderInspectPage(req, res) {
    res.sendFile(path.join(__dirname, '../views/inspect.html'));
  }

  /**
   * Pre-check: count documents in old and new collections.
   */
  async migrationPrecheck(req, res) {
    try {
      const db = mongoose.connection.db;
      const oldTracks = await db.collection('tracks').countDocuments();
      const artists = await Artist.countDocuments();
      const albums = await Album.countDocuments();
      const trackMetas = await TrackMeta.countDocuments();
      const scrobbles = await Scrobble.countDocuments();

      return res.json({
        success: true,
        counts: {
          oldTracks,
          artists,
          albums,
          trackMetas,
          scrobbles,
        },
      });
    } catch (error) {
      console.error('❌ Migration precheck error:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Pre-check ล้มเหลว',
      });
    }
  }

  /**
   * Run the migration with streaming NDJSON progress.
   */
  async runMigration(req, res) {
    const isDryRun = req.body?.dryRun !== false;
    const BATCH_SIZE = 200;
    const PROGRESS_INTERVAL = 300;

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (obj) => {
      res.write(JSON.stringify(obj) + '\n');
    };

    const stats = {
      total: 0,
      processed: 0,
      artists: 0,
      albums: 0,
      trackMetas: 0,
      scrobbles: 0,
      errors: 0,
    };

    const artistCache = new Map();
    const albumCache = new Map();
    const trackCache = new Map();

    const getOrCreateArtist = async (name, extra = {}) => {
      if (!name?.trim()) return null;
      const lower = name.trim().toLowerCase();
      if (artistCache.has(lower)) return artistCache.get(lower);
      if (isDryRun) {
        const fake = { _id: new mongoose.Types.ObjectId(), name: name.trim(), nameLower: lower };
        artistCache.set(lower, fake);
        stats.artists++;
        return fake;
      }
      const doc = await Artist.findOrCreateByName(name.trim(), extra);
      artistCache.set(lower, doc);
      stats.artists++;
      return doc;
    };

    const getOrCreateAlbum = async (name, artistId, extra = {}) => {
      if (!name?.trim() || !artistId) return null;
      const lower = cleanAlbumName(name.trim().toLowerCase());
      const key = `${lower}|${artistId}`;
      if (albumCache.has(key)) return albumCache.get(key);
      if (isDryRun) {
        const fake = { _id: new mongoose.Types.ObjectId(), name: name.trim(), nameLower: lower, artist: artistId };
        albumCache.set(key, fake);
        stats.albums++;
        return fake;
      }
      const doc = await Album.findOrCreateByNameAndArtist(name.trim(), artistId, extra);
      albumCache.set(key, doc);
      stats.albums++;
      return doc;
    };

    const getOrCreateTrackMeta = async (title, artistId, albumId, extra = {}) => {
      if (!title?.trim() || !artistId) return null;
      const lower = title.trim().toLowerCase();
      const key = `${lower}|${artistId}`;
      if (trackCache.has(key)) return trackCache.get(key);
      if (isDryRun) {
        const fake = { _id: new mongoose.Types.ObjectId(), title: title.trim(), titleLower: lower, artist: artistId, album: albumId };
        trackCache.set(key, fake);
        stats.trackMetas++;
        return fake;
      }
      const doc = await TrackMeta.findOrCreateByIdentity(title.trim(), artistId, albumId, extra);
      trackCache.set(key, doc);
      stats.trackMetas++;
      return doc;
    };

    try {
      const db = mongoose.connection.db;
      const oldTracks = db.collection('tracks');

      stats.total = await oldTracks.countDocuments();
      send({ type: 'start', total: stats.total });

      if (stats.total === 0) {
        send({ type: 'done', ...stats });
        return res.end();
      }

      const cursor = oldTracks.find().sort({ scrobbledAt: 1 }).batchSize(BATCH_SIZE);

      for await (const doc of cursor) {
        stats.processed++;

        try {
          if (doc.eventType && doc.eventType !== 'scrobble') continue;

          const artistName = doc.artist;
          const albumName = doc.album;
          const trackTitle = doc.title;

          if (!artistName || !trackTitle) { stats.errors++; continue; }

          const artistDoc = await getOrCreateArtist(artistName, {
            artistUrl: doc.artistUrl || undefined,
          });
          if (!artistDoc) { stats.errors++; continue; }

          let albumDoc = null;
          if (albumName?.trim()) {
            albumDoc = await getOrCreateAlbum(albumName, artistDoc._id, {
              year: doc.year || undefined,
              trackArtUrl: doc.trackArtUrl || undefined,
              albumUrl: doc.albumUrl || undefined,
            });
          }

          const tmExtra = {
            duration: doc.duration || undefined,
            trackNumber: doc.trackNumber || undefined,
            genre: doc.genre || undefined,
            trackUrl: doc.trackUrl || undefined,
            trackArtUrl: doc.trackArtUrl || undefined,
          };
          if (doc.spotify) {
            tmExtra.spotify = doc.spotify;
            tmExtra.spotify_enriched = doc.spotify_enriched;
            tmExtra.spotify_search_attempted = doc.spotify_search_attempted;
            tmExtra.spotify_match_found = doc.spotify_match_found;
          }
          if (doc.animationUrl) tmExtra.animationUrl = doc.animationUrl;
          if (doc.appleMusicUrl) tmExtra.appleMusicUrl = doc.appleMusicUrl;
          if (doc.animation_search_attempted !== undefined) tmExtra.animation_search_attempted = doc.animation_search_attempted;
          if (doc.animation_match_found !== undefined) tmExtra.animation_match_found = doc.animation_match_found;

          const trackMeta = await getOrCreateTrackMeta(
            trackTitle, artistDoc._id, albumDoc?._id || null, tmExtra
          );
          if (!trackMeta) { stats.errors++; continue; }

          if (!isDryRun) {
            await Scrobble.create({
              track: trackMeta._id,
              timestamp: doc.timestamp || doc.scrobbledAt || new Date(),
              scrobbledAt: doc.scrobbledAt || doc.timestamp || new Date(),
              source: doc.source || 'web-scrobbler',
              connector: doc.connector,
              originalUrl: doc.originalUrl,
              eventType: doc.eventType || 'scrobble',
              isLoved: doc.isLoved || false,
              isLovedInService: doc.isLovedInService,
              playCount: doc.playCount || 1,
              userPlayCount: doc.userPlayCount,
              metadataLabel: doc.metadataLabel,
              albumArtist: doc.albumArtist,
              isScrobbled: doc.isScrobbled !== false,
              isCorrectedByUser: doc.isCorrectedByUser || false,
              isValid: doc.isValid !== false,
              startTimestamp: doc.startTimestamp,
              currentTime: doc.currentTime,
              userAgent: doc.userAgent,
              ipAddress: doc.ipAddress,
              rawData: doc.rawData,
            });
          }
          stats.scrobbles++;

        } catch (err) {
          stats.errors++;
          send({ type: 'error', docId: String(doc._id), message: err.message });
        }

        // Send progress every N docs
        if (stats.processed % PROGRESS_INTERVAL === 0) {
          const pct = ((stats.processed / stats.total) * 100).toFixed(1);
          send({
            type: 'progress',
            processed: stats.processed,
            total: stats.total,
            pct,
            artists: stats.artists,
            albums: stats.albums,
            trackMetas: stats.trackMetas,
            sclobbles: stats.scrobbles,
            scrobbles: stats.scrobbles,
            errors: stats.errors,
          });
        }
      }

      send({ type: 'done', ...stats });
      res.end();

    } catch (error) {
      console.error('❌ Migration error:', error);
      send({ type: 'error', docId: 'fatal', message: error.message });
      send({ type: 'done', ...stats });
      res.end();
    }
  }
}

export default new SystemController();
