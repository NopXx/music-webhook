
import { describe, expect, test, mock } from "bun:test";
import scrobbleService from "../services/scrobbleService.js";

// Mock dependencies
mock.module("../models/Track.js", () => ({
  default: {
    findByIdAndUpdate: async () => {},
  },
}));

mock.module("../services/spotifyService.js", () => ({
  default: {
    isConfigured: () => false,
  },
}));

mock.module("../services/appleMusicService.js", () => ({
  default: {
    fetchAnimatedArtwork: async () => ({ success: false }),
  },
}));

describe("ScrobbleService", () => {
  describe("legacyParseScrobbleData", () => {
    test("should parse standard web-scrobbler format", () => {
      const body = {
        track: {
          title: "Test Track",
          artist: "Test Artist",
          album: "Test Album",
          duration: 120,
        },
        connector: "Spotify",
      };
      
      const result = scrobbleService.legacyParseScrobbleData(body, {}, "user-agent", "127.0.0.1");
      
      expect(result.title).toBe("Test Track");
      expect(result.artist).toBe("Test Artist");
      expect(result.connector).toBe("Spotify");
    });

    test("should parse new web-scrobbler format (eventName)", () => {
       const body = {
        eventName: "scrobble",
        data: {
          song: {
            processed: {
              track: "New Track",
              artist: "New Artist",
              duration: 180,
            },
            connector: { label: "YouTube" },
          }
        }
      };

      const result = scrobbleService.legacyParseScrobbleData(body, {}, "user-agent", "127.0.0.1");

      expect(result.title).toBe("New Track");
      expect(result.artist).toBe("New Artist");
      expect(result.connector).toBe("YouTube");
    });
  });

  describe("buildTrackDataFromValidated", () => {
      test("should use validated track data if provided", () => {
          const validated = {
            title: "Validated Title",
            artist: "Validated Artist",
            trackArtUrl: "http://example.com/art.jpg",
            duration: 200,
            source: "test-source",
            rawFormat: "simple"
          };
          
          const result = scrobbleService.buildTrackDataFromValidated(
            {},
            { userAgent: "ua", ipAddress: "1.1.1.1" },
            validated
          );
          
          expect(result.title).toBe("Validated Title");
          expect(result.artist).toBe("Validated Artist");
          expect(result.trackArtUrl).toBe("http://example.com/art.jpg");
          expect(result.userAgent).toBe("ua");
      });

      test("should handle ListenBrainz import format specifically", () => {
          const validated = {
              title: "LB Title",
              artist: "LB Artist",
              rawFormat: "listenbrainz-import",
              eventName: "scrobble"
          };
          const body = {
              track_metadata: {
                  additional_info: {
                      cover_art_url: "http://lb.com/cover.jpg"
                  }
              }
          };

          const result = scrobbleService.buildTrackDataFromValidated(
              body,
              {},
              validated
          );

          expect(result.title).toBe("LB Title");
          expect(result.trackArtUrl).toBe("http://lb.com/cover.jpg");
          // Check if listenbrainz specific fields are populated
          expect(result.musicbrainz).toBeDefined();
      });
  });
});
