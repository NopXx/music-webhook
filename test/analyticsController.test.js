
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import analyticsController from "../controllers/analyticsController.js";

// Mock dependencies
const mockAnalyticsService = {
  getStatsOverview: mock(async () => ({
    window: { range: 'all-time' },
    totals: { totalPlays: 100 },
    connectors: [],
    recent: [],
    topArtists: []
  })),
  getTracksListing: mock(async () => ({
    tracks: [],
    pagination: { page: 1, total: 0 }
  })),
  getTopArtistsLeaderboard: mock(async () => ({ items: [] })),
  getTopTracksLeaderboard: mock(async () => ({ items: [] })),
  getTrackInsights: mock(async () => ({ overview: {} })),
  getAlbumInsights: mock(async () => ({ overview: {} })),
  getArtistProfileData: mock(async () => ({ overview: {} }))
};

mock.module("../services/analyticsService.js", () => mockAnalyticsService);

const mockSpotifyService = {
  isConfigured: mock(() => false),
  getSpotifyStats: mock(async () => ({}))
};

mock.module("../services/spotifyService.js", () => mockSpotifyService);

mock.module("../models/Track.js", () => ({
  default: {
    getSpotifyStats: mock(async () => ([{}]))
  }
}));

describe("AnalyticsController", () => {
  let req, res;

  beforeEach(() => {
    req = { query: {}, params: {} };
    res = {
      status: mock(() => res),
      json: mock(() => res)
    };
  });

  afterEach(() => {
    mock.restore();
  });

  describe("getStats", () => {
    test("should return stats overview with default parameters", async () => {
      await analyticsController.getStats(req, res);

      expect(mockAnalyticsService.getStatsOverview).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
    });

    test("should include spotify stats if configured", async () => {
      mockSpotifyService.isConfigured.mockReturnValue(true);
      await analyticsController.getStats(req, res);
      
      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];
      expect(response.spotify.configured).toBe(true);
    });
  });

  describe("getRecentTracks", () => {
    test("should fetch recent tracks with pagination params", async () => {
      req.query = { page: "2", limit: "20" };
      await analyticsController.getRecentTracks(req, res);

      expect(mockAnalyticsService.getTracksListing).toHaveBeenCalledWith(expect.objectContaining({
        page: "2",
        limit: "20"
      }));
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("getTopArtistsLeaderboard", () => {
    test("should return leaderboard data", async () => {
      await analyticsController.getTopArtistsLeaderboard(req, res);
      expect(mockAnalyticsService.getTopArtistsLeaderboard).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

   describe("getTrackAnalytics", () => {
    test("should return 400 if artist or title is missing", async () => {
      req.query = { artist: "Start" }; // Missing title
      await analyticsController.getTrackAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("should return analytics if found", async () => {
      req.query = { artist: "Artist", title: "Title" };
      mockAnalyticsService.getTrackInsights.mockResolvedValueOnce({ meta: {} });
      await analyticsController.getTrackAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("should return 404 if not found", async () => {
      req.query = { artist: "Artist", title: "Title" };
      mockAnalyticsService.getTrackInsights.mockResolvedValueOnce(null);
      await analyticsController.getTrackAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
