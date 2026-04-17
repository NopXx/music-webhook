import spotifyService from '../services/spotifyService.js';
import scrobbleService from '../services/scrobbleService.js';
import TrackMeta from '../models/TrackMeta.js';

// Helper for concurrency control
async function pMap(array, mapper, concurrency = 5) {
  const results = [];
  const iterator = array.entries();
  const workers = new Array(concurrency).fill(iterator).map(async (iter) => {
    for (const [index, item] of iter) {
      try {
        results[index] = await mapper(item, index);
      } catch (err) {
        results[index] = { error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

class SpotifyController {
  
  /**
   * Get Spotify integration status
   */
  async getSpotifyStatus(req, res) {
    try {
      const isConfigured = spotifyService.isConfigured();
      const cacheStats = await spotifyService.getCacheStats();
      
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

  /**
   * Get Spotify enrichment statistics
   */
  async getSpotifyStats(req, res) {
    try {
      const spotifyStats = await TrackMeta.getSpotifyStats();
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
        cache_stats: await spotifyService.getCacheStats()
      });
    } catch (error) {
      console.error('❌ Error getting Spotify stats:', error);
      res.status(500).json({
        error: 'Failed to get Spotify statistics',
        message: error.message
      });
    }
  }

  /**
   * Manually trigger enrichment for tracks
   */
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
        tracksToEnrich = await TrackMeta.find({})
          .sort({ updatedAt: -1 })
          .limit(limit);
      } else {
        tracksToEnrich = await TrackMeta.findWithoutSpotifyData(limit);
      }
      
      if (tracksToEnrich.length === 0) {
        return res.status(200).json({
          message: 'No tracks need Spotify enrichment',
          processed: 0
        });
      }
      
      console.log(`🎵 Starting Spotify enrichment for ${tracksToEnrich.length} tracks...`);
      
      // Optimized parallel processing
      let enriched = 0;
      let errors = 0;

      await pMap(tracksToEnrich, async (track) => {
        try {
          await scrobbleService.enrichWithSpotifyData(track);
          enriched++;
        } catch (error) {
          console.error(`❌ Failed to enrich track ${track._id}:`, error.message);
          errors++;
        }
      }, 5); // Concurrency limit of 5
      
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

  /**
   * Update missing Spotify data for existing tracks
   */
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
      const priorityFieldsArray = priorityFields
        .split(',')
        .map(field => field.trim())
        .filter(Boolean);
      
      console.log(`🔄 Starting Spotify data update for existing tracks...`);

      // Query logic remains same...
      let query = {};
      if (forceUpdate) {
        query = { eventType: 'scrobble' };
      } else if (onlyMissingBasicData) {
        const missingFieldConditions = [];
        if (priorityFieldsArray.includes('duration')) missingFieldConditions.push({ duration: null }, { duration: { $exists: false } });
        if (priorityFieldsArray.includes('album')) missingFieldConditions.push({ album: null }, { album: '' }, { album: { $exists: false } });
        if (priorityFieldsArray.includes('year')) missingFieldConditions.push({ year: null }, { year: { $exists: false } });
        if (priorityFieldsArray.includes('trackNumber')) missingFieldConditions.push({ trackNumber: null }, { trackNumber: { $exists: false } });

        if (missingFieldConditions.length === 0) {
          missingFieldConditions.push(
            { duration: null }, { duration: { $exists: false } },
            { album: null }, { album: '' }, { album: { $exists: false } },
            { year: null }, { year: { $exists: false } }
          );
        }

        const searchRetryConditions = {
          $or: [
            { spotify_search_attempted: { $ne: true } },
            { spotify_match_found: { $ne: true } },
          ],
        };

        query = {
          eventType: 'scrobble',
          $and: [{ $or: missingFieldConditions }, searchRetryConditions]
        };
      } else {
        query = {
          eventType: 'scrobble',
          spotify_search_attempted: { $ne: true }
        };
      }

      const tracksToUpdate = await TrackMeta.find(query)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select('_id title artist album duration trackNumber spotify_search_attempted spotify_enriched');

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
          duration: 0, album: 0, year: 0, trackNumber: 0
        }
      };

      // Concurrent processing with pMap
      await pMap(tracksToUpdate, async (track, i) => {
        try {
          // console.log(`🔍 [${i + 1}/${tracksToUpdate.length}] Processing: ${track.artist} - ${track.title}`);
          
          const beforeUpdate = {
            duration: track.duration,
            album: track.album,
            year: track.year,
            trackNumber: track.trackNumber
          };
          
          await scrobbleService.enrichWithSpotifyData(track);
          
          const updatedTrack = await TrackMeta.findById(track._id);
          
          if (updatedTrack && updatedTrack.spotify_enriched) {
            stats.enriched++;
            
            if (beforeUpdate.duration !== updatedTrack.duration && updatedTrack.duration) stats.fields_updated.duration++;
            if (beforeUpdate.album !== updatedTrack.album && updatedTrack.album) stats.fields_updated.album++;
            if (beforeUpdate.year !== updatedTrack.year && updatedTrack.year) stats.fields_updated.year++;
            if (beforeUpdate.trackNumber !== updatedTrack.trackNumber && updatedTrack.trackNumber) stats.fields_updated.trackNumber++;
            
            // console.log(`✅ Successfully enriched: ${track.artist} - ${track.title}`);
          } else {
            stats.no_match++;
            // console.log(`❌ No Spotify match: ${track.artist} - ${track.title}`);
          }
          
          stats.processed++;
        } catch (error) {
          stats.errors++;
          console.error(`❌ Error processing track ${track._id}: ${error.message}`);
        }
      }, 5); // Concurrency limit 5

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

  /**
   * Clear Spotify search cache
   */
  async clearSpotifyCache(req, res) {
    try {
      const cacheStatsBefore = await spotifyService.getCacheStats();
      await spotifyService.clearCache();
      
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
}

export default new SpotifyController();
