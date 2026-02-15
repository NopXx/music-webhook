import scrobbleController from '../controllers/scrobbleController.js';
import analyticsController from '../controllers/analyticsController.js';
import playerController from '../controllers/playerController.js';
import spotifyController from '../controllers/spotifyController.js';
import systemController from '../controllers/systemController.js';

// Export an object that matches the interface expected by index.js
const WebhookRoutes = {
  // Scrobble & Import
  handleScrobble: scrobbleController.handleScrobble.bind(scrobbleController),
  renderListenBrainzImportPage: scrobbleController.renderListenBrainzImportPage.bind(scrobbleController),
  importListenBrainz: scrobbleController.importListenBrainz.bind(scrobbleController),
  updateTrackLovedStatus: scrobbleController.updateTrackLovedStatus.bind(scrobbleController),

  // Analytics & Data
  getStats: analyticsController.getStats.bind(analyticsController),
  getRecentTracks: analyticsController.getRecentTracks.bind(analyticsController),
  getTopArtistsLeaderboard: analyticsController.getTopArtistsLeaderboard.bind(analyticsController),
  getTopTracksLeaderboard: analyticsController.getTopTracksLeaderboard.bind(analyticsController),
  getTrackAnalytics: analyticsController.getTrackAnalytics.bind(analyticsController),
  getAlbumAnalytics: analyticsController.getAlbumAnalytics.bind(analyticsController),
  getArtistProfile: analyticsController.getArtistProfile.bind(analyticsController),

  // Player (Now Playing)
  getNowPlaying: playerController.getNowPlaying.bind(playerController),
  setNowPlaying: playerController.setNowPlaying.bind(playerController),

  // Spotify
  getSpotifyStatus: spotifyController.getSpotifyStatus.bind(spotifyController),
  getSpotifyStats: spotifyController.getSpotifyStats.bind(spotifyController),
  enrichTracksWithSpotify: spotifyController.enrichTracksWithSpotify.bind(spotifyController),
  updateMissingSpotifyData: spotifyController.updateMissingSpotifyData.bind(spotifyController),
  clearSpotifyCache: spotifyController.clearSpotifyCache.bind(spotifyController),

  // System
  healthCheck: systemController.healthCheck.bind(systemController),
  removeDuplicates: systemController.removeDuplicates.bind(systemController),
  getDuplicateStats: systemController.getDuplicateStats.bind(systemController),
  deleteTracksByDateRange: systemController.deleteTracksByDateRange.bind(systemController),
  handleRoot: systemController.handleRoot.bind(systemController),
};

export default WebhookRoutes;
