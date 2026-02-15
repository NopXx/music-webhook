import nowPlayingService from '../services/nowPlayingService.js';

class PlayerController {
  
  /**
   * Get current Now Playing status
   */
  getNowPlaying(req, res) {
    const status = nowPlayingService.getStatus();
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
}

export default new PlayerController();
