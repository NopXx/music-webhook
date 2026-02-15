
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

// 1. Setup Mocks BEFORE importing the controller
const mockSpotifyService = {
  isConfigured: mock(() => true),
  getCacheStats: mock(() => ({ size: 5, hits: 10, misses: 2 })),
  clearCache: mock(() => {}),
};

const mockScrobbleService = {
  enrichWithSpotifyData: mock(async () => {})
};

const mockTrack = {
  getSpotifyStats: mock(async () => ([{
      total: 100,
      spotify_enriched: 50,
      spotify_search_attempted: 80,
      spotify_match_found: 50
  }])),
  find: mock(() => ({
      sort: mock(() => ({
          limit: mock(async () => [])
      })),
      limit: mock(() => ({ 
          select: mock(async () => []) 
      }))
  })),
  findWithoutSpotifyData: mock(async () => []),
  findById: mock(async () => null)
};

// 2. Register Mocks
// helper to mock default export
mock.module("../services/spotifyService.js", () => ({
  default: mockSpotifyService
}));

mock.module("../services/scrobbleService.js", () => ({
  default: mockScrobbleService
}));

mock.module("../models/Track.js", () => ({
  default: mockTrack
}));

// 3. Dynamic Import of Controller
const { default: spotifyController } = await import("../controllers/spotifyController.js");

describe("SpotifyController", () => {
  let req, res;

  beforeEach(() => {
    req = { query: {}, params: {} };
    res = {
      status: mock(() => res),
      json: mock(() => res)
    };
    mockSpotifyService.isConfigured.mockReturnValue(true);
    mockTrack.findWithoutSpotifyData.mockResolvedValue([]);
  });

  afterEach(() => {
    mock.restore();
  });

  describe("getSpotifyStatus", () => {
    test("should return status and configuration", async () => {
      await spotifyController.getSpotifyStatus(req, res);
      
      expect(mockSpotifyService.isConfigured).toHaveBeenCalled();
      expect(mockSpotifyService.getCacheStats).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          configured: true,
          cache: expect.any(Object)
      }));
    });
  });

  describe("getSpotifyStats", () => {
    test("should return enrichment statistics", async () => {
      await spotifyController.getSpotifyStats(req, res);
      
      expect(mockTrack.getSpotifyStats).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          enrichment_rate_percent: 50,
          match_rate_percent: 63 // 50/80 * 100
      }));
    });
  });

  describe("enrichTracksWithSpotify", () => {
    test("should return 400 if not configured", async () => {
        mockSpotifyService.isConfigured.mockReturnValue(false);
        await spotifyController.enrichTracksWithSpotify(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test("should handle no tracks needing enrichment", async () => {
        mockTrack.findWithoutSpotifyData.mockResolvedValue([]);
        await spotifyController.enrichTracksWithSpotify(req, res);
        
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            processed: 0
        }));
    });

    test("should enrich tracks successfully", async () => {
       const mockTracks = [{ _id: 1, artist: "A", title: "T" }];
       mockTrack.findWithoutSpotifyData.mockResolvedValue(mockTracks);
       
       await spotifyController.enrichTracksWithSpotify(req, res);
       
       expect(mockScrobbleService.enrichWithSpotifyData).toHaveBeenCalled();
       expect(res.status).toHaveBeenCalledWith(200);
       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
           processed: 1,
           enriched: 1
       }));
    });
  });

  describe("clearSpotifyCache", () => {
      test("should clear cache and return stats", async () => {
          await spotifyController.clearSpotifyCache(req, res);
          
          expect(mockSpotifyService.clearCache).toHaveBeenCalled();
          expect(res.status).toHaveBeenCalledWith(200);
      });
  });
});
