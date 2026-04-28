import Scrobble from '../models/Scrobble.js';
import TrackMeta from '../models/TrackMeta.js';
import scrobbleService from '../services/scrobbleService.js';
import nowPlayingService from '../services/nowPlayingService.js';
import spotifyService from '../services/spotifyService.js';
import appleMusicService from '../services/appleMusicService.js';
import { normalizeListenBrainzEntry } from '../middleware/validation.js';
import { updateLovedTrackStatus } from '../services/analyticsService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ScrobbleController {
  
  /**
   * Handle scrobble request
   */
  async handleScrobble(req, res) {
    try {
      const { validatedTrack } = req;
      const trackData = scrobbleService.parseScrobbleData(req.body, req, validatedTrack);
      
      if (trackData.eventType === 'paused' || trackData.eventType === 'stopped') {
        nowPlayingService.updateFromEvent(trackData);
        const npStatus = nowPlayingService.getStatus();
        return res.status(200).json({
          success: true,
          action: 'ignored',
          message: `Now playing ${trackData.eventType}`,
          nowPlaying: npStatus,
          track: {
            title: trackData.title,
            artist: trackData.artist,
          }
        });
      }

      if (trackData.eventType === 'nowplaying') {
        nowPlayingService.setPlaying(trackData);

        // Background: enrich with Apple Music animated artwork (fire-and-forget)
        if (trackData.title && trackData.artist) {
          appleMusicService.fetchAnimatedArtwork(trackData.title, trackData.artist, trackData.album || '')
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

        const npStatus = nowPlayingService.getStatus();
        return res.status(200).json({
          success: true,
          message: 'Now playing updated',
          nowPlaying: npStatus,
          track: {
            title: trackData.title,
            artist: trackData.artist,
            album: trackData.album
          }
        });
      }

      // Use the new normalized pipeline: Artist → Album → TrackMeta → Scrobble
      const result = await Scrobble.findOrCreateScrobble(trackData);
      const action = result.action || 'created';

      if (action === 'ignored' || action === 'skipped') {
        console.log(`⏭️ ${action}: ${trackData.artist} - ${trackData.title}`);
        return res.status(200).json({
          success: true,
          action,
          message: action === 'ignored' ? 'Non-scrobble event ignored' : 'Duplicate scrobble skipped',
          track: {
            title: trackData.title,
            artist: trackData.artist,
          }
        });
      }

      const trackMeta = result._trackMeta;
      console.log(`📝 Scrobble ${action}: ${trackData.artist} - ${trackData.title} [${trackData.connector || ''}]`);

      // Trigger background enrichment on TrackMeta (fire and forget)
      
      // 1. Apple Music Animated Artwork
      if (trackMeta && !trackMeta.animation_search_attempted && !trackMeta.animationUrl) {
        setTimeout(() => {
          scrobbleService.enrichWithAnimationData(result).catch(err => {
            console.error(`❌ Background animation enrichment failed for TrackMeta ${trackMeta._id}:`, err.message);
          });
        }, 100);
      }

      // 2. Spotify Metadata
      if (trackMeta && !trackMeta.spotify_search_attempted && spotifyService.isConfigured()) {
        setTimeout(() => {
          scrobbleService.enrichWithSpotifyData(result).catch(err => {
            console.error(`❌ Background Spotify enrichment failed for TrackMeta ${trackMeta._id}:`, err.message);
          });
        }, 200);
      }

      return res.status(200).json({
        success: true,
        action,
        scrobble: result,
        message: 'Scrobble received successfully'
      });

    } catch (error) {
      console.error('❌ Error processing scrobble:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error processing scrobble'
      });
    }
  }

  /**
   * Update track loved status
   */
  async updateTrackLovedStatus(req, res) {
    try {
      const { id, isLoved } = req.body || {};
      if (!id) {
        return res.status(400).json({
          error: 'Missing track id',
          message: 'Please provide track id in request body'
        });
      }

      if (typeof isLoved !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid payload',
          message: 'isLoved must be a boolean value'
        });
      }

      const updated = await updateLovedTrackStatus({ id, isLoved });
      res.status(200).json({
        success: true,
        track: updated
      });
    } catch (error) {
      console.error('❌ Error updating loved status:', error);
      const statusCode = error.message === 'Track not found' ? 404 : 500;
      res.status(statusCode).json({
        error: statusCode === 404 ? 'Track not found' : 'Failed to update loved status',
        message: error.message
      });
    }
  }

  /**
   * Render ListenBrainz Import UI
   */
  renderListenBrainzImportPage(req, res) {
    res.sendFile(path.join(__dirname, '../views/listenbrainz_import.html'));
  }

  /**
   * Handle ListenBrainz bulk import
   */
  async importListenBrainz(req, res) {
    try {
      const payload = req.body;
      const entries = [];
      const errors = [];

      const pushEntry = (entry, source) => {
        if (entry && typeof entry === 'object') {
          entries.push({ entry, source });
        } else {
          errors.push({
            source,
            message: 'รายการที่ระบุไม่ใช่ JSON object'
          });
        }
      };

      const parseRawString = (text) => {
        if (typeof text !== 'string') return;
        const trimmed = text.trim();
        if (!trimmed) {
          errors.push({ source: 'raw', message: 'ไม่พบข้อมูลใน raw text' });
          return;
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            parsed.forEach((item, idx) => pushEntry(item, `raw[${idx}]`));
          } else if (parsed && typeof parsed === 'object') {
            pushEntry(parsed, 'raw');
          } else {
            errors.push({ source: 'raw', message: 'ข้อมูล raw ควรเป็น JSON object หรือ array ของ object' });
          }
        } catch (err) {
          const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (lines.length === 0) {
            errors.push({ source: 'raw', message: 'ไม่พบ JSON object ใน raw text' });
            return;
          }
          lines.forEach((line, idx) => {
            try {
              const parsedLine = JSON.parse(line);
              pushEntry(parsedLine, `raw line ${idx + 1}`);
            } catch (lineErr) {
              errors.push({
                source: `raw line ${idx + 1}`,
                message: lineErr?.message || 'ไม่สามารถแปลง JSON ได้'
              });
            }
          });
        }
      };

      if (Array.isArray(payload)) {
        payload.forEach((entry, idx) => pushEntry(entry, `body[${idx}]`));
      } else if (Array.isArray(payload?.entries)) {
        payload.entries.forEach((entry, idx) => pushEntry(entry, `entries[${idx}]`));
      } else if (typeof payload?.raw === 'string') {
        parseRawString(payload.raw);
      } else if (payload && typeof payload === 'object' && payload.track_metadata) {
        pushEntry(payload, 'body');
      } else if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
        errors.push({ source: 'body', message: 'รูปแบบข้อมูลไม่ตรงกับ ListenBrainz import' });
      }

      if (entries.length === 0) {
        const message = errors.length
          ? 'ไม่สามารถนำเข้าข้อมูลได้'
          : 'ไม่พบข้อมูลสำหรับนำเข้า';
        return res.status(400).json({
          success: false,
          message,
          total: 0,
          processed: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          ignored: 0,
          spotifyQueued: 0,
          errors
        });
      }

      const summary = {
        total: entries.length,
        processed: 0,
        created: [],
        updated: [],
        skipped: [],
        ignored: [],
        spotifyQueued: 0,
        errors
      };

      const context = {
        userAgent: 'ListenBrainz Import UI',
        ipAddress: req.ip || req.connection?.remoteAddress || 'listenbrainz-import-ui'
      };

      for (const { entry, source } of entries) {
        try {
          const normalized = normalizeListenBrainzEntry(entry);
          const trackData = scrobbleService.buildTrackDataFromValidated(entry, context, normalized);
          if (!trackData) {
            throw new Error('ไม่สามารถสร้างข้อมูล track จาก entry นี้ได้');
          }

          const result = await Scrobble.findOrCreateScrobble(trackData);
          const action = result.action || 'created';

          const preview = {
            id: result._id,
            title: trackData.title,
            artist: trackData.artist,
            album: trackData.album,
            timestamp: trackData.timestamp,
            connector: trackData.connector,
            source: trackData.source,
            trackArtUrl: trackData.trackArtUrl,
          };

          if (action === 'created') {
            summary.created.push(preview);
          } else if (action === 'updated') {
            summary.updated.push(preview);
          } else if (action === 'ignored') {
            summary.ignored.push(preview);
          } else {
            summary.skipped.push(preview);
          }

          // Enrich with Spotify if needed
          const trackMeta = result._trackMeta;
          if (trackMeta && !trackMeta.spotify_search_attempted && spotifyService.isConfigured()) {
            summary.spotifyQueued += 1;
            setTimeout(() => {
              scrobbleService.enrichWithSpotifyData(result).catch((error) => {
                console.error(`❌ Failed to enrich TrackMeta ${trackMeta._id} during import:`, error.message);
              });
            }, 100);
          }
        } catch (error) {
          summary.errors.push({
            source,
            message: error?.message || 'เกิดข้อผิดพลาดระหว่างนำเข้า'
          });
        }
      }

      summary.processed =
        summary.created.length +
        summary.updated.length +
        summary.skipped.length +
        summary.ignored.length;

      const success = summary.errors.length === 0;
      const message = success
        ? 'นำเข้าข้อมูลสำเร็จ'
        : (summary.processed > 0
            ? 'นำเข้าบางส่วนสำเร็จ มีข้อผิดพลาดบางรายการ'
            : 'ไม่สามารถนำเข้าข้อมูลได้');

      const response = {
        success,
        message,
        total: summary.total,
        processed: summary.processed,
        created: summary.created.length,
        updated: summary.updated.length,
        skipped: summary.skipped.length,
        ignored: summary.ignored.length,
        spotifyQueued: summary.spotifyQueued,
        errors: summary.errors,
        items: {
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          ignored: summary.ignored
        }
      };

      const statusCode = success ? 200 : (summary.processed > 0 ? 207 : 400);
      return res.status(statusCode).json(response);
    } catch (error) {
      console.error('❌ ListenBrainz import error:', error);
      return res.status(500).json({
        success: false,
        message: error?.message || 'ไม่สามารถนำเข้าข้อมูลได้',
        errors: [{ source: 'system', message: error?.message || 'Unknown error' }]
      });
    }
  }
}

export default new ScrobbleController();
