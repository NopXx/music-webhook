import nowPlayingService from '../services/nowPlayingService.js';
import appleMusicService from '../services/appleMusicService.js';

class PlayerController {
  
  /**
   * Get current Now Playing status
   * Optimized with ETag / 304 Not Modified support
   */
  getNowPlaying(req, res) {
    const status = nowPlayingService.getStatus();

    // Generate ETag from lastUpdate timestamp (changes when state changes)
    const etag = `"np-${status.updatedAt ? new Date(status.updatedAt).getTime() : 0}"`;

    // Support conditional requests — return 304 if client ETag matches
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.set({
      'Cache-Control': 'no-cache',
      'ETag': etag,
    });

    // Slim response when not playing — skip heavy track data
    if (!status.playing && status.status !== 'paused') {
      return res.status(200).json({
        playing: false,
        status: status.status,
        updatedAt: status.updatedAt,
        track: null,
      });
    }

    res.status(200).json(status);
  }

  /**
   * Set Now Playing status manually
   */
  setNowPlaying(req, res) {
    try {
      const { state, track } = req.body;
      
      if (!state || !['playing', 'paused', 'stopped'].includes(state)) {
        return res.status(400).json({
          error: 'Invalid state',
          message: 'State must be one of: playing, paused, stopped'
        });
      }

      if (state === 'playing' && (!track || !track.title || !track.artist)) {
        return res.status(400).json({
          error: 'Invalid track data',
          message: 'Track title and artist are required when state is playing'
        });
      }

      if (state === 'playing') {
        nowPlayingService.setPlaying(track);

        // Background: enrich with Apple Music animated artwork (fire-and-forget)
        if (track.title && track.artist) {
          this._enrichNowPlayingArtwork(track.title, track.artist, track.album);
        }
      } else if (state === 'paused') {
        nowPlayingService.setPaused();
      } else {
        nowPlayingService.setStopped();
      }

      const status = nowPlayingService.getStatus();
      res.status(200).json({
        success: true,
        message: `Now playing status updated to ${state}`,
        ...status
      });

    } catch (error) {
      console.error('❌ Error setting now playing:', error);
      res.status(500).json({
        error: 'Failed to set now playing status',
        message: error.message
      });
    }
  }

  /**
   * Background: fetch Apple Music animated artwork and patch into
   * the in-memory now-playing track (fire-and-forget).
   */
  _enrichNowPlayingArtwork(title, artist, album = '') {
    appleMusicService.fetchAnimatedArtwork(title, artist, album)
      .then(result => {
        if (result.success && result.animationUrl && nowPlayingService.current?.track) {
          nowPlayingService.current.track.animationUrl = result.animationUrl;
          if (result.appleMusicUrl) {
            nowPlayingService.current.track.appleMusicUrl = result.appleMusicUrl;
          }
          nowPlayingService._invalidateCache();
        }
      })
      .catch(err => {
        console.error('❌ Background NP artwork enrichment failed:', err.message);
      });
  }
}

export default new PlayerController();
