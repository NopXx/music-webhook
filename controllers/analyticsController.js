import {
  getStatsOverview,
  getTracksListing,
  getTopArtistsLeaderboard as fetchTopArtistsLeaderboard,
  getTopTracksLeaderboard as fetchTopTracksLeaderboard,
  getTrackInsights,
  getAlbumInsights,
  getArtistProfileData
} from '../services/analyticsService.js';
import spotifyService from '../services/spotifyService.js';
import TrackMeta from '../models/TrackMeta.js';

class AnalyticsController {
  
  /**
   * Get statistics overview
   */
  async getStats(req, res) {
    try {
      const range = req.query.range || 'all-time';
      const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : 0;
      const recentLimit = Number.isFinite(Number(req.query.recentLimit))
        ? Math.max(1, Math.min(25, Number(req.query.recentLimit)))
        : 10;

      const overview = await getStatsOverview({
        range,
        offset,
        recentLimit,
        topArtistLimit: Number(req.query.topArtistLimit) || 5
      });

      let spotifyStats = null;
      if (spotifyService.isConfigured()) {
        try {
          const spotifyData = await TrackMeta.getSpotifyStats();
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

      res.status(200).json({
        range: overview.window,
        totals: overview.totals,
        connectors: overview.connectors,
        topArtists: overview.topArtists,
        recentScrobbles: overview.recent,
        lastScrobble: overview.recent?.[0]?.scrobbledAt || null,
        spotify: spotifyStats
      });

    } catch (error) {
      console.error('❌ Error getting stats:', error);
      
      res.status(500).json({ 
        error: 'Failed to get statistics',
        message: error.message 
      });
    }
  }

  /**
   * Get recent tracks listing with pagination
   */
  async getRecentTracks(req, res) {
    try {
      const listing = await getTracksListing({
        page: req.query.page,
        limit: req.query.limit,
        offset: req.query.offset,
        sortBy: req.query.sortBy,
        order: req.query.order,
        search: req.query.search,
        searchTitle: req.query.searchTitle,
        searchArtist: req.query.searchArtist,
        searchAlbum: req.query.searchAlbum,
        connector: req.query.connector,
        source: req.query.source,
        range: req.query.range,
        rangeOffset: req.query.rangeOffset
      });

      res.status(200).json(listing);

    } catch (error) {
      console.error('❌ Error getting recent tracks:', error);
      
      res.status(500).json({ 
        error: 'Failed to get recent tracks',
        message: error.message 
      });
    }
  }

  /**
   * Get top artists leaderboard
   */
  async getTopArtistsLeaderboard(req, res) {
    try {
      const range = req.query.range || 'week';
      const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : 0;
      const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 10;

      const leaderboard = await fetchTopArtistsLeaderboard({
        range,
        offset,
        limit
      });

      res.status(200).json(leaderboard);
    } catch (error) {
      console.error('❌ Error getting top artists leaderboard:', error);
      res.status(500).json({
        error: 'Failed to get top artists leaderboard',
        message: error.message
      });
    }
  }

  /**
   * Get top tracks leaderboard
   */
  async getTopTracksLeaderboard(req, res) {
    try {
      const range = req.query.range || 'week';
      const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : 0;
      const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 15;

      const leaderboard = await fetchTopTracksLeaderboard({
        range,
        offset,
        limit
      });

      res.status(200).json(leaderboard);
    } catch (error) {
      console.error('❌ Error getting top tracks leaderboard:', error);
      res.status(500).json({
        error: 'Failed to get top tracks leaderboard',
        message: error.message
      });
    }
  }

  /**
   * Get analytics for a specific track
   */
  async getTrackAnalytics(req, res) {
    try {
      const { artist, title, recentLimit, tz } = req.query || {};
      if (!artist || !title) {
        return res.status(400).json({
          error: 'Missing parameters',
          message: 'artist and title are required'
        });
      }

      const insights = await getTrackInsights({
        artist,
        title,
        recentLimit: Number.isFinite(Number(recentLimit)) ? Number(recentLimit) : 12,
        timezone: tz
      });

      if (!insights) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Track analytics not available (no scrobbles found)'
        });
      }

      res.status(200).json({
        meta: {
          artist,
          title,
          timezone: tz || undefined
        },
        ...insights
      });
    } catch (error) {
      console.error('❌ Error getting track analytics:', error);
      res.status(500).json({
        error: 'Failed to get track analytics',
        message: error.message
      });
    }
  }

  /**
   * Get analytics for a specific album
   */
  async getAlbumAnalytics(req, res) {
    try {
      const { artist, album, recentLimit, tz } = req.query || {};
      if (!artist || !album) {
        return res.status(400).json({
          error: 'Missing parameters',
          message: 'artist and album are required'
        });
      }

      const insights = await getAlbumInsights({
        artist,
        album,
        recentLimit: Number.isFinite(Number(recentLimit)) ? Number(recentLimit) : 12,
        timezone: tz
      });

      if (!insights) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Album analytics not available (no scrobbles found)'
        });
      }

      res.status(200).json({
        meta: {
          artist,
          album,
          timezone: tz || undefined
        },
        ...insights
      });
    } catch (error) {
      console.error('❌ Error getting album analytics:', error);
      res.status(500).json({
        error: 'Failed to get album analytics',
        message: error.message
      });
    }
  }

  /**
   * Get artist profile and analytics
   */
  async getArtistProfile(req, res) {
    try {
      const rawName = req.params.name || '';
      let decodedName = rawName;
      try {
        decodedName = decodeURIComponent(rawName);
      } catch (decodeError) {
        console.warn('⚠️ Unable to decode artist name from path, using raw value');
      }
      const { tz, limit, recentLimit } = req.query || {};

      if (!decodedName) {
        return res.status(400).json({
          error: 'Missing artist name',
          message: 'Artist name is required in the path parameter'
        });
      }

      const profile = await getArtistProfileData({
        name: decodedName,
        tz,
        topLimit: Number.isFinite(Number(limit)) ? Number(limit) : 10,
        recentLimit: Number.isFinite(Number(recentLimit)) ? Number(recentLimit) : 15
      });

      if (!profile) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Artist profile not available (no scrobbles found)'
        });
      }

      res.status(200).json({
        artist: decodedName,
        timezone: tz || undefined,
        ...profile
      });
    } catch (error) {
      console.error('❌ Error getting artist profile:', error);
      res.status(500).json({
        error: 'Failed to get artist profile',
        message: error.message
      });
    }
  }
}

export default new AnalyticsController();
