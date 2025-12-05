import Track from '../models/Track.js';
import spotifyService from '../services/spotifyService.js';
import appleMusicService from '../services/appleMusicService.js';
import nowPlayingService from '../services/nowPlayingService.js';
import { normalizeListenBrainzEntry } from '../middleware/validation.js';
import {
  getStatsOverview,
  getTracksListing,
  updateLovedTrackStatus as setLovedFlag,
  getTopArtistsLeaderboard as fetchTopArtistsLeaderboard,
  getTopTracksLeaderboard as fetchTopTracksLeaderboard,
  getTrackInsights,
  getAlbumInsights,
  getArtistProfileData
} from '../services/analyticsService.js';

export class WebhookRoutes {
  constructor() {
    this.handleScrobble = this.handleScrobble.bind(this);
    this.getStats = this.getStats.bind(this);
    this.getRecentTracks = this.getRecentTracks.bind(this);
    this.healthCheck = this.healthCheck.bind(this);
    this.enrichWithSpotifyData = this.enrichWithSpotifyData.bind(this);
    this.getSpotifyStatus = this.getSpotifyStatus.bind(this);
    this.getSpotifyStats = this.getSpotifyStats.bind(this);
    this.enrichTracksWithSpotify = this.enrichTracksWithSpotify.bind(this);
    this.clearSpotifyCache = this.clearSpotifyCache.bind(this);
    this.updateMissingSpotifyData = this.updateMissingSpotifyData.bind(this);
    this.getNowPlaying = this.getNowPlaying.bind(this);
    this.setNowPlaying = this.setNowPlaying.bind(this);
    this.renderListenBrainzImportPage = this.renderListenBrainzImportPage.bind(this);
    this.importListenBrainz = this.importListenBrainz.bind(this);
    this.deleteTracksByDateRange = this.deleteTracksByDateRange.bind(this);
    this.updateTrackLovedStatus = this.updateTrackLovedStatus.bind(this);
    this.getTopArtistsLeaderboard = this.getTopArtistsLeaderboard.bind(this);
    this.getTopTracksLeaderboard = this.getTopTracksLeaderboard.bind(this);
    this.getTrackAnalytics = this.getTrackAnalytics.bind(this);
    this.getAlbumAnalytics = this.getAlbumAnalytics.bind(this);
    this.getArtistProfile = this.getArtistProfile.bind(this);
    this.enrichWithAnimationData = this.enrichWithAnimationData.bind(this);
  }

  // Handle incoming scrobble data
  async handleScrobble(req, res) {
    try {
      const body = req.body;
      const validatedTrack = req.validatedTrack; // From validation middleware
      
      // Create track data using validated information and metadata
      const trackData = this.parseScrobbleData(body, req, validatedTrack);

      // Update in-memory Now Playing status for any event
      const shouldUpdateNowPlaying = (() => {
        if (trackData?.source !== 'listenbrainz') return true;
        const eventTimestamp = trackData?.timestamp instanceof Date
          ? trackData.timestamp
          : (trackData?.timestamp ? new Date(trackData.timestamp) : null);
        if (!eventTimestamp || !Number.isFinite(eventTimestamp.getTime())) {
          return false;
        }
        const ageMs = Date.now() - eventTimestamp.getTime();
        const maxAgeMs = 5 * 60 * 1000; // 5 minutes tolerance
        return Math.abs(ageMs) <= maxAgeMs;
      })();

      if (shouldUpdateNowPlaying) {
        try {
          nowPlayingService.updateFromEvent(trackData);
        } catch (npErr) {
          console.warn('⚠️ Failed to update Now Playing state:', npErr?.message || npErr);
        }
      }
      
      // Use findOrCreateTrack to avoid duplicates
      const savedTrack = await Track.findOrCreateTrack(trackData);
      
      // ถ้าเป็น track ใหม่หรือ track ที่ยังไม่มีข้อมูล Spotify ให้ไปดึงข้อมูล
      const shouldEnrichWithSpotify = 
        (savedTrack.action === 'created' || 
        (savedTrack.action === 'updated' && !savedTrack.spotify_search_attempted)) ||
        (!savedTrack.spotify_search_attempted && savedTrack.eventType === 'scrobble');
        
      if (shouldEnrichWithSpotify && spotifyService.isConfigured()) {
        // ดึงข้อมูลจาก Spotify แบบ async (ไม่ให้ผู้ใช้รอ)
        // ใช้ setTimeout เพื่อให้ response ส่งกลับก่อน แล้วค่อย enrich
        setTimeout(() => {
          this.enrichWithSpotifyData(savedTrack).catch(error => {
            console.error(`❌ Failed to enrich track ${savedTrack._id} with Spotify data:`, error.message);
          });
        }, 100); // รอ 100ms ให้ response ออกไปก่อน
      }

      // Enrich animationUrl ถ้าไม่มีข้อมูล (ใช้ Apple Music API)
      const shouldEnrichAnimation = 
        (savedTrack.action === 'created' || savedTrack.action === 'updated') &&
        !savedTrack.animationUrl &&
        !savedTrack.animation_search_attempted;
        
      if (shouldEnrichAnimation) {
        setTimeout(() => {
          this.enrichWithAnimationData(savedTrack).catch(error => {
            console.error(`❌ Failed to enrich track ${savedTrack._id} with animation data:`, error.message);
          });
        }, 200); // รอ 200ms ให้ Spotify enrich ไปก่อน
      }
      
      const message = savedTrack.action === 'created' ? 'Track saved successfully' :
                      savedTrack.action === 'updated' ? 'Track updated successfully' :
                      (savedTrack.action === 'ignored' && savedTrack.eventType !== 'scrobble') ? `Now playing status updated to ${savedTrack.eventType}` :
                      'Track already exists';

      res.status(200).json({ 
        success: true, 
        message: message,
        trackId: savedTrack._id,
        action: savedTrack.action,
        spotify_configured: spotifyService.isConfigured(),
        spotify_enrichment_queued: shouldEnrichWithSpotify,
        now_playing: nowPlayingService.getStatus(),
        track: {
          artist: savedTrack.artist,
          title: savedTrack.title,
          album: savedTrack.album,
          duration: savedTrack.duration,
          connector: savedTrack.connector,
          eventType: savedTrack.eventType,
          userPlayCount: savedTrack.userPlayCount,
          timestamp: savedTrack.timestamp,
          trackArtUrl: savedTrack.trackArtUrl,
          artistUrl: savedTrack.artistUrl,
          albumUrl: savedTrack.albumUrl,
          originalUrl: savedTrack.originalUrl,
          spotify_enriched: savedTrack.spotify_enriched,
          spotify_data: savedTrack.spotify_enriched ? {
            spotify_id: savedTrack.spotify?.id,
            spotify_url: savedTrack.spotify?.url,
            album_art: savedTrack.spotify?.album?.images?.[0]?.url
          } : null
        }
      });

    } catch (error) {
      console.error('❌ Error processing scrobble:', error.message);
      
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  }

  // Get current Now Playing status (in-memory)
  async getNowPlaying(req, res) {
    try {
      const status = nowPlayingService.getStatus();
      res.status(200).json({
        message: 'Current now playing status',
        ...status,
      });
    } catch (error) {
      console.error('❌ Error getting now playing status:', error);
      res.status(500).json({
        error: 'Failed to get now playing status',
        message: error.message,
      });
    }
  }

  // Manually update/refresh playing status
  async setNowPlaying(req, res) {
    try {
      const { track, currentTime, duration } = req.body || {};
      const status = (req.body && req.body.status) ? req.body.status : 'playing';

      if (status === 'playing') {
        if (track && (track.title && track.artist)) {
          // Force set with track details if provided
          nowPlayingService.forcePlaying({
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: typeof duration === 'number' ? duration : track.duration,
            connector: track.connector,
            originalUrl: track.originalUrl,
            trackArtUrl: track.trackArtUrl,
            artistUrl: track.artistUrl,
            trackUrl: track.trackUrl,
            albumUrl: track.albumUrl,
            currentTime: typeof currentTime === 'number' ? currentTime : undefined,
          });
        } else {
          // Refresh existing playing state
          nowPlayingService.refreshPlaying({
            currentTime: typeof currentTime === 'number' ? currentTime : null,
            duration: typeof duration === 'number' ? duration : null,
          });
        }
      } else if (status === 'paused') {
        nowPlayingService.setPaused({
          ...(track || {}),
          currentTime: typeof currentTime === 'number' ? currentTime : undefined,
          duration: typeof duration === 'number' ? duration : (track?.duration ?? undefined),
        });
      } else if (status === 'stopped') {
        nowPlayingService.setStopped(track || {});
      } else {
        return res.status(400).json({
          error: 'Invalid status',
          message: 'status must be one of: playing, paused, stopped'
        });
      }

      return res.status(200).json({
        message: 'Now playing status updated',
        ...nowPlayingService.getStatus(),
      });
    } catch (error) {
      console.error('❌ Error setting now playing status:', error);
      res.status(500).json({
        error: 'Failed to set now playing status',
        message: error.message,
      });
    }
  }

  buildTrackDataFromValidated(body, context = {}, validatedTrack = null) {
    if (!validatedTrack) return null;

    const userAgent = context.userAgent || '';
    const ipAddress = context.ipAddress || 'unknown';
    const coerceNumber = (value) => {
      if (value === undefined || value === null) return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const parseStartTimestamp = (value) => {
      if (value === undefined || value === null) return null;
      if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value : null;
      }
      if (typeof value === 'string' && value.trim().length === 0) {
        return null;
      }
      const numeric = coerceNumber(value);
      if (numeric !== null) {
        const millis = numeric > 1e12 ? numeric : numeric * 1000;
        const date = new Date(millis);
        return Number.isFinite(date.getTime()) ? date : null;
      }
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    };
    const mergeMetadata = (target = {}, source = {}) => {
      if (!source || typeof source !== 'object') return target;
      const next = { ...target };
      const setString = (key, value) => {
        if (typeof value === 'string' && value.trim().length > 0) {
          next[key] = value.trim();
        }
      };
      setString('trackArtUrl', source.trackArtUrl);
      setString('artistUrl', source.artistUrl);
      setString('trackUrl', source.trackUrl);
      setString('albumUrl', source.albumUrl);
      setString('metadataLabel', source.label ?? source.metadataLabel);
      setString('animationUrl', source.animationUrl);
      setString('masterTallUrl', source.masterTallUrl);
      setString('primaryMediaUrl', source.primaryMediaUrl);
      setString('primaryMediaType', source.primaryMediaType);

      const userPlayCount = coerceNumber(source.userPlayCount);
      if (userPlayCount !== null) {
        next.userPlayCount = userPlayCount;
      }

      if (typeof source.userloved === 'boolean') {
        next.isLovedInService = source.userloved;
      }
      if (typeof source.isLovedInService === 'boolean') {
        next.isLovedInService = source.isLovedInService;
      }
      if (typeof source.isLoved === 'boolean') {
        next.isLovedInService = source.isLoved;
      }

      const start = parseStartTimestamp(source.startTimestamp);
      if (start) {
        next.startTimestamp = start;
      }

      const current = coerceNumber(source.currentTime);
      if (current !== null) {
        next.currentTime = current;
      }

      return next;
    };

    let metadata = {
      userPlayCount: coerceNumber(validatedTrack.userPlayCount),
      trackArtUrl: validatedTrack.trackArtUrl || null,
      artistUrl: validatedTrack.artistUrl || null,
      trackUrl: validatedTrack.trackUrl || null,
      albumUrl: validatedTrack.albumUrl || null,
      metadataLabel: validatedTrack.metadataLabel || null,
      animationUrl: validatedTrack.animationUrl || null,
      masterTallUrl: validatedTrack.masterTallUrl || null,
      primaryMediaUrl: validatedTrack.primaryMediaUrl || null,
      primaryMediaType: validatedTrack.primaryMediaType || null,
      isLovedInService: typeof validatedTrack.isLovedInService === 'boolean'
        ? validatedTrack.isLovedInService
        : null,
      startTimestamp: parseStartTimestamp(validatedTrack.startTimestamp),
      currentTime: coerceNumber(validatedTrack.currentTime),
    };
    let flags = {};

    metadata = mergeMetadata(metadata, body?.metadata);
    if (body?.data && typeof body.data === 'object') {
      metadata = mergeMetadata(metadata, body.data.metadata);
    }

    if ((validatedTrack.rawFormat || '').toLowerCase() === 'listenbrainz-import') {
      const trackMetadata = body.track_metadata || {};
      const mapping = trackMetadata.mbid_mapping || {};
      const additionalInfo = trackMetadata.additional_info || {};

      const listenedAt = validatedTrack.listenedAt instanceof Date
        ? validatedTrack.listenedAt
        : (validatedTrack.listenedAt ? new Date(validatedTrack.listenedAt) : null);
      const insertedAt = validatedTrack.insertedAt instanceof Date
        ? validatedTrack.insertedAt
        : (validatedTrack.insertedAt ? new Date(validatedTrack.insertedAt) : null);
      const timestamp = listenedAt || (validatedTrack.timestamp ? new Date(validatedTrack.timestamp) : new Date());

      const trackData = {
        title: validatedTrack.title,
        artist: validatedTrack.artist,
        album: validatedTrack.album || trackMetadata.release_name || '',
        albumArtist: '',
        genre: '',
        year: null,
        trackNumber: null,
        duration: validatedTrack.duration,
        timestamp,
        source: validatedTrack.source || 'listenbrainz',
        connector: validatedTrack.connector || 'listenbrainz',
        originalUrl: validatedTrack.originalUrl || additionalInfo.listen_url || additionalInfo.track_url || '',
        trackArtUrl: validatedTrack.trackArtUrl
          || additionalInfo.cover_art_url
          || additionalInfo.coverart
          || additionalInfo.album_art_url
          || additionalInfo.album_coverart_url
          || additionalInfo.track_art_url
          || additionalInfo.image
          || additionalInfo.image_url
          || (mapping.caa_release_mbid || mapping.release_mbid
            ? (mapping.caa_id
              ? `https://coverartarchive.org/release/${mapping.caa_release_mbid || mapping.release_mbid}/${mapping.caa_id}.jpg`
              : `https://coverartarchive.org/release/${mapping.caa_release_mbid || mapping.release_mbid}/front`)
            : null),
        scrobbledAt: listenedAt || insertedAt || timestamp,
        eventType: validatedTrack.eventName || 'scrobble',
        userAgent,
        ipAddress,
        rawData: {
          ...body,
          format: validatedTrack.rawFormat,
          eventName: validatedTrack.eventName
        }
      };

      if (additionalInfo.lastfm_track_mbid) {
        trackData.lastfmMbid = additionalInfo.lastfm_track_mbid;
      }

      trackData.musicbrainz = {
        recordingMbid: mapping.recording_mbid || null,
        releaseMbid: mapping.release_mbid || null,
        caaId: mapping.caa_id || null,
        caaReleaseMbid: mapping.caa_release_mbid || null,
        recordingMsid: trackMetadata.recording_msid || null,
        artistMbids: mapping.artist_mbids || null
      };

      return trackData;
    }

    if (body.eventName && body.data && body.data.song) {
      const song = body.data.song;

      metadata = mergeMetadata(metadata, song.metadata);

      if (song.flags) {
        flags = {
          isScrobbled: song.flags.isScrobbled || false,
          isCorrectedByUser: song.flags.isCorrectedByUser || false,
          isValid: song.flags.isValid !== false,
        };
      }

      const trackData = song.parsed || song.processed || {};
      metadata = mergeMetadata(metadata, { currentTime: trackData.currentTime });
    }

    return {
      title: validatedTrack.title,
      artist: validatedTrack.artist,
      album: validatedTrack.album || '',
      albumArtist: '',
      genre: '',
      year: null,
      trackNumber: null,
      duration: validatedTrack.duration,
      timestamp: validatedTrack.timestamp ? new Date(validatedTrack.timestamp) : new Date(),
      source: validatedTrack.source || 'web-scrobbler',
      connector: validatedTrack.connector,
      originalUrl: validatedTrack.originalUrl,
      ...metadata,
      ...flags,
      eventType: validatedTrack.eventName || 'unknown',
      userAgent,
      ipAddress,
      rawData: {
        ...body,
        format: validatedTrack.rawFormat,
        eventName: validatedTrack.eventName
      }
    };
  }

  // Parse scrobble data from various formats
  parseScrobbleData(body, req, validatedTrack = null) {
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

    // Use validated track data if available
    if (validatedTrack) {
      const trackData = this.buildTrackDataFromValidated(
        body,
        { userAgent, ipAddress },
        validatedTrack
      );
      if (trackData) {
        return trackData;
      }
    }

    // Fallback to legacy parsing (for backward compatibility)
    console.log('⚠️ Using legacy parsing method');
    
    // ... rest of legacy code remains the same
    return this.legacyParseScrobbleData(body, req, userAgent, ipAddress);
  }
  
  // Legacy parsing method for backward compatibility
  legacyParseScrobbleData(body, req, userAgent, ipAddress) {
    // Default track data structure
    let trackData = {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      genre: '',
      year: null,
      trackNumber: null,
      duration: null,
      timestamp: new Date(),
      source: 'web-scrobbler',
      connector: '',
      originalUrl: '',
      eventType: 'unknown',
      userAgent,
      ipAddress,
      rawData: body
    };

    // Handle different web-scrobbler formats (legacy support)
    if (body.eventName && body.data && body.data.song) {
      // New web-scrobbler format
      const song = body.data.song;
      const trackInfo = song.parsed || song.processed || song.noRegex || {};
      
      trackData = {
        ...trackData,
        title: trackInfo.track || '',
        artist: trackInfo.artist || '',
        album: trackInfo.album || '',
        duration: trackInfo.duration || null,
        connector: song.connector ? (song.connector.label || song.connector.id) : '',
        originalUrl: trackInfo.originUrl || '',
        timestamp: body.time ? new Date(body.time) : new Date(),
        eventType: body.eventName || 'unknown',
      };
    } else if (body.track) {
      // Standard web-scrobbler format
      const track = body.track;
      trackData = {
        ...trackData,
        title: track.title || track.name || '',
        artist: track.artist || '',
        album: track.album || '',
        albumArtist: track.albumArtist || track.album_artist || '',
        duration: track.duration || track.length || null,
        connector: body.connector || body.source || '',
        originalUrl: track.url || body.url || '',
        timestamp: track.timestamp ? new Date(track.timestamp * 1000) : new Date(),
      };
    } else if (body.artist && body.title) {
      // Simple format
      trackData = {
        ...trackData,
        title: body.title,
        artist: body.artist,
        album: body.album || '',
        duration: body.duration || null,
        connector: body.connector || body.source || '',
        originalUrl: body.url || '',
        timestamp: body.timestamp ? new Date(body.timestamp * 1000) : new Date(),
      };
    } else if (body.nowPlaying) {
      // Now playing format
      const np = body.nowPlaying;
      trackData = {
        ...trackData,
        title: np.title || np.track || '',
        artist: np.artist || '',
        album: np.album || '',
        duration: np.duration || null,
        connector: body.source || 'web-scrobbler',
        originalUrl: np.url || '',
        eventType: 'nowplaying',
      };
    }

    // Clean up and validate required fields
    if (!trackData.title || !trackData.artist) {
      throw new Error('Missing required fields: title and artist');
    }

    return trackData;
  }

  renderListenBrainzImportPage(req, res) {
    res.type('html').send(`<!DOCTYPE html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <title>ListenBrainz Import UI</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f172a;
        --surface: rgba(30, 41, 59, 0.85);
        --surface-alt: rgba(15, 23, 42, 0.7);
        --border: rgba(148, 163, 184, 0.3);
        --accent: #38bdf8;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --danger: #fb7185;
        --success: #34d399;
      }
      *, *::before, *::after { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        background: linear-gradient(135deg, var(--bg), #020617);
        color: var(--text);
        padding: 2.5rem 1.5rem 4rem;
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 2.5rem 2rem 3rem;
        backdrop-filter: blur(24px);
        box-shadow: 0 40px 60px -24px rgba(15, 23, 42, 0.65);
      }
      header h1 {
        margin: 0;
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      header p {
        margin: 0.5rem 0 0;
        color: var(--muted);
        font-size: 0.95rem;
      }
      section {
        margin-top: 2rem;
      }
      label {
        display: inline-block;
        margin-bottom: 0.75rem;
        font-weight: 600;
        color: #bae6fd;
        letter-spacing: 0.01em;
        text-transform: uppercase;
        font-size: 0.75rem;
      }
      textarea {
        width: 100%;
        min-height: 260px;
        border-radius: 16px;
        border: 1px solid var(--border);
        padding: 1rem 1.25rem;
        resize: vertical;
        background: var(--surface-alt);
        color: var(--text);
        font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', monospace;
        font-size: 0.95rem;
        line-height: 1.5;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }
      textarea:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        margin-top: 1rem;
      }
      .btn {
        position: relative;
        border: none;
        border-radius: 999px;
        padding: 0.75rem 1.5rem;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .btn:disabled {
        cursor: not-allowed;
        opacity: 0.65;
      }
      .btn-primary {
        background: var(--accent);
        color: #0f172a;
        box-shadow: 0 12px 30px -12px rgba(56, 189, 248, 0.6);
      }
      .btn-primary:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 15px 35px -12px rgba(56, 189, 248, 0.75);
      }
      .btn-secondary {
        background: rgba(148, 163, 184, 0.12);
        color: var(--text);
        border: 1px solid rgba(148, 163, 184, 0.2);
      }
      .btn-secondary:hover:not(:disabled) {
        transform: translateY(-2px);
        border-color: rgba(148, 163, 184, 0.35);
      }
      input[type="file"] {
        color: var(--muted);
        font-size: 0.9rem;
      }
      .hint {
        color: var(--muted);
        font-size: 0.9rem;
        margin-top: 0.5rem;
      }
      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin: 1.5rem 0;
      }
      .stat-card {
        flex: 1 1 180px;
        background: rgba(15, 23, 42, 0.55);
        border: 1px solid rgba(56, 189, 248, 0.15);
        border-radius: 20px;
        padding: 1.25rem;
      }
      .stat-card h3 {
        margin: 0 0 0.25rem;
        font-size: 2rem;
      }
      .stat-card span {
        color: var(--muted);
        font-size: 0.85rem;
      }
      .alert {
        margin-top: 1.5rem;
        padding: 1rem 1.25rem;
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(15, 23, 42, 0.55);
      }
      .alert.success {
        border-color: rgba(52, 211, 153, 0.45);
        color: var(--success);
      }
      .alert.error {
        border-color: rgba(251, 113, 133, 0.45);
        color: var(--danger);
      }
      .result-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 1.5rem;
        border-radius: 18px;
        overflow: hidden;
      }
      .result-table thead {
        background: rgba(56, 189, 248, 0.1);
      }
      .result-table th, .result-table td {
        padding: 0.85rem 1rem;
        text-align: left;
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      }
      .result-table tbody tr:hover {
        background: rgba(56, 189, 248, 0.05);
      }
      pre {
        margin: 0.75rem 0 0;
        padding: 0.75rem 1rem;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid rgba(148, 163, 184, 0.2);
        color: var(--muted);
        overflow-x: auto;
      }
      footer {
        margin-top: 3rem;
        text-align: center;
        color: rgba(148, 163, 184, 0.6);
        font-size: 0.85rem;
      }
      @media (max-width: 720px) {
        main {
          padding: 1.75rem 1.25rem 2.25rem;
        }
        header h1 {
          font-size: 1.65rem;
        }
        .controls {
          flex-direction: column;
          align-items: stretch;
        }
        .controls .btn, .controls input[type="file"] {
          width: 100%;
          justify-content: center;
        }
        textarea {
          min-height: 200px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>นำเข้าข้อมูลจาก ListenBrainz</h1>
        <p>รองรับ JSON ปกติหรือ JSON Lines ที่ได้จาก ListenBrainz / Last.fm importer – ระบบจะเรียกใช้ webhook parser เดิมทุกขั้นตอน</p>
      </header>

      <section>
        <form id="import-form">
          <label for="payload">วางข้อมูล JSON หรือ JSON Lines</label>
          <textarea id="payload" name="payload" placeholder='{"inserted_at": ..., "listened_at": ..., "track_metadata": {...}}'></textarea>
          <div class="hint" id="entry-count">จำนวนเอนทรี: 0</div>

          <div class="controls">
            <button type="submit" class="btn btn-primary" id="import-btn">🚀 นำเข้า</button>
            <button type="button" class="btn btn-secondary" id="sample-btn">เติมตัวอย่าง</button>
            <label class="btn btn-secondary" for="file-input">📁 เลือกไฟล์</label>
            <input type="file" id="file-input" accept=".json,.jsonl,.txt" style="display:none" />
            <button type="button" class="btn btn-secondary" id="clear-btn">ล้างข้อมูล</button>
          </div>
        </form>
      </section>

      <section id="status-block" style="display:none;">
        <div class="stats">
          <div class="stat-card">
            <h3 id="stat-total">0</h3>
            <span>รับเข้ามาทั้งหมด</span>
          </div>
          <div class="stat-card">
            <h3 id="stat-created">0</h3>
            <span>สร้างใหม่</span>
          </div>
          <div class="stat-card">
            <h3 id="stat-updated">0</h3>
            <span>อัปเดต</span>
          </div>
          <div class="stat-card">
            <h3 id="stat-skipped">0</h3>
            <span>ข้าม/ซ้ำ</span>
          </div>
        </div>

        <div id="alert-container"></div>

        <div id="errors-container" style="display:none;">
          <h3>รายการที่ผิดพลาด</h3>
          <table class="result-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ตำแหน่ง</th>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody id="error-rows"></tbody>
          </table>
        </div>

        <div id="items-container" style="display:none;">
          <h3>ตัวอย่างรายการล่าสุด</h3>
          <table class="result-table">
            <thead>
              <tr>
                <th>สถานะ</th>
                <th>ศิลปิน - เพลง</th>
                <th>อัลบั้ม</th>
                <th>เวลา</th>
              </tr>
            </thead>
            <tbody id="item-rows"></tbody>
          </table>
        </div>
      </section>

      <footer>
        ListenBrainz Import UI · ข้อมูลทั้งหมดจะถูกประมวลผลผ่านเส้นทาง /api/import/listenbrainz
      </footer>
    </main>

    <script>
      const textarea = document.getElementById('payload');
      const fileInput = document.getElementById('file-input');
      const form = document.getElementById('import-form');
      const importBtn = document.getElementById('import-btn');
      const statusBlock = document.getElementById('status-block');
      const entryCount = document.getElementById('entry-count');
      const alertContainer = document.getElementById('alert-container');
      const errorContainer = document.getElementById('errors-container');
      const errorRows = document.getElementById('error-rows');
      const itemsContainer = document.getElementById('items-container');
      const itemRows = document.getElementById('item-rows');
      const statTotal = document.getElementById('stat-total');
      const statCreated = document.getElementById('stat-created');
      const statUpdated = document.getElementById('stat-updated');
      const statSkipped = document.getElementById('stat-skipped');

      const samplePayload = '{\\n  "inserted_at": 1759922716.660063,\\n  "listened_at": 1733035913,\\n  "track_metadata": {\\n    "track_name": "Supernova Love",\\n    "artist_name": "IVE & David Guetta",\\n    "mbid_mapping": {\\n      "caa_id": 40393843035,\\n      "artists": [\\n        {\\n          "artist_mbid": "b2f2216a-d7a9-4ce0-8b8f-f494d9a8c196",\\n          "join_phrase": " & ",\\n          "artist_credit_name": "IVE"\\n        },\\n        {\\n          "artist_mbid": "302bd7b9-d012-4360-897a-93b00c855680",\\n          "join_phrase": "",\\n          "artist_credit_name": "David Guetta"\\n        }\\n      ],\\n      "artist_mbids": [\\n        "b2f2216a-d7a9-4ce0-8b8f-f494d9a8c196",\\n        "302bd7b9-d012-4360-897a-93b00c855680"\\n      ],\\n      "release_mbid": "d7a8fdca-a620-4517-819b-79b0ba4671ab",\\n      "recording_mbid": "f28e2528-210a-44c6-96e0-031d5c29cf85",\\n      "recording_name": "Supernova Love",\\n      "caa_release_mbid": "1097924e-b972-471e-927f-cb2e443387e4"\\n    },\\n    "release_name": "Supernova Love",\\n    "recording_msid": "60ce36d4-d91e-4e42-95da-c0574b1f3405",\\n    "additional_info": {\\n      "lastfm_track_mbid": "f28e2528-210a-44c6-96e0-031d5c29cf85",\\n      "submission_client": "ListenBrainz lastfm importer v2"\\n    }\\n  }\\n}\\n';

      function countEntries(text) {
        const trimmed = text.trim();
        if (!trimmed) return 0;
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.length;
          if (parsed && typeof parsed === 'object') return 1;
        } catch (err) {
          const lines = trimmed.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
          return lines.length;
        }
        return 0;
      }

      function setLoading(isLoading) {
        importBtn.disabled = isLoading;
        importBtn.textContent = isLoading ? '⏳ กำลังนำเข้า...' : '🚀 นำเข้า';
      }

      function resetOutput() {
        alertContainer.innerHTML = '';
        errorContainer.style.display = 'none';
        errorRows.innerHTML = '';
        itemsContainer.style.display = 'none';
        itemRows.innerHTML = '';
      }

      function renderAlert(type, message) {
        alertContainer.innerHTML = '<div class="alert ' + type + '">' + message + '</div>';
      }

      function appendErrorRow(index, source, message) {
        const row = document.createElement('tr');
        row.innerHTML = '<td>' + index + '</td><td>' + source + '</td><td>' + message + '</td>';
        errorRows.appendChild(row);
      }

      function appendItemRow(status, track) {
        const row = document.createElement('tr');
        const displayStatus = status === 'created' ? '🆕 สร้างใหม่' : status === 'updated' ? '🔄 อัปเดต' : '⏭️ ข้าม';
        const timestamp = track.timestamp ? new Date(track.timestamp).toLocaleString() : '-';
        row.innerHTML = '<td>' + displayStatus + '</td><td>' + (track.artist || '-') + ' - ' + (track.title || '-') + '</td><td>' + (track.album || '-') + '</td><td>' + timestamp + '</td>';
        itemRows.appendChild(row);
      }

      textarea.addEventListener('input', () => {
        entryCount.textContent = 'จำนวนเอนทรี: ' + countEntries(textarea.value);
      });

      document.getElementById('sample-btn').addEventListener('click', () => {
        textarea.value = samplePayload.trim();
        entryCount.textContent = 'จำนวนเอนทรี: ' + countEntries(textarea.value);
      });

      document.getElementById('clear-btn').addEventListener('click', () => {
        textarea.value = '';
        entryCount.textContent = 'จำนวนเอนทรี: 0';
        statusBlock.style.display = 'none';
        resetOutput();
      });

      fileInput.addEventListener('change', (event) => {
        const [file] = event.target.files;
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          textarea.value = reader.result;
          entryCount.textContent = 'จำนวนเอนทรี: ' + countEntries(textarea.value);
        };
        reader.readAsText(file, 'utf-8');
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const raw = textarea.value.trim();
        if (!raw) {
          renderAlert('error', 'กรุณาวางข้อมูล JSON หรือ JSON Lines ก่อน');
          statusBlock.style.display = 'block';
          return;
        }

        setLoading(true);
        resetOutput();

        try {
          const response = await fetch('/api/import/listenbrainz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw })
          });

          const result = await response.json();
          statusBlock.style.display = 'block';

          statTotal.textContent = result.total ?? 0;
          statCreated.textContent = result.created ?? 0;
          statUpdated.textContent = result.updated ?? 0;
          statSkipped.textContent = (result.skipped ?? 0) + (result.ignored ?? 0);

          if (result.success) {
            renderAlert('success', result.message || 'นำเข้าข้อมูลสำเร็จ');
          } else {
            renderAlert('error', result.message || 'นำเข้าบางส่วนสำเร็จ แต่มีข้อผิดพลาด');
          }

          if (Array.isArray(result.errors) && result.errors.length > 0) {
            errorContainer.style.display = '';
            result.errors.forEach((err, idx) => {
              appendErrorRow(idx + 1, err.source || '-', err.message || 'ไม่ทราบสาเหตุ');
            });
          }

          const previewItems = [];
          if (result.items) {
            ['created', 'updated', 'skipped'].forEach((key) => {
              if (Array.isArray(result.items[key])) {
                result.items[key].slice(0, 10).forEach((item) => previewItems.push({ status: key, ...item }));
              }
            });
          }

          if (previewItems.length > 0) {
            itemsContainer.style.display = '';
            previewItems.forEach((item) => appendItemRow(item.status, item));
          }
        } catch (error) {
          statusBlock.style.display = 'block';
          renderAlert('error', error?.message || 'เกิดข้อผิดพลาดระหว่างส่งข้อมูล');
        } finally {
          setLoading(false);
        }
      });
    </script>
  </body>
</html>`);
  }

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
          const trackData = this.buildTrackDataFromValidated(entry, context, normalized);
          if (!trackData) {
            throw new Error('ไม่สามารถสร้างข้อมูล track จาก entry นี้ได้');
          }

          const savedTrack = await Track.findOrCreateTrack(trackData);
          const action = savedTrack.action || (savedTrack.isNew ? 'created' : 'updated');

          const preview = {
            id: savedTrack._id,
            title: savedTrack.title,
            artist: savedTrack.artist,
            album: savedTrack.album,
            timestamp: savedTrack.timestamp,
            connector: savedTrack.connector,
            source: savedTrack.source,
            trackArtUrl: savedTrack.trackArtUrl
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

          const shouldEnrichWithSpotify =
            (savedTrack.action === 'created' ||
              (savedTrack.action === 'updated' && !savedTrack.spotify_search_attempted)) ||
            (!savedTrack.spotify_search_attempted && savedTrack.eventType === 'scrobble');

          if (shouldEnrichWithSpotify && spotifyService.isConfigured()) {
            summary.spotifyQueued += 1;
            setTimeout(() => {
              this.enrichWithSpotifyData(savedTrack).catch((error) => {
                console.error(`❌ Failed to enrich track ${savedTrack._id} during import:`, error.message);
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

      const totalMatches = await Track.countDocuments(filter);

      if (String(dryRun).toLowerCase() === 'true') {
        return res.status(200).json({
          success: true,
          message: 'Dry run: ไม่ได้ลบข้อมูล',
          matches: totalMatches,
          filter
        });
      }

      const result = await Track.deleteMany(filter);

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

  // Get statistics
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
          const spotifyData = await Track.getSpotifyStats();
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

  // Get recent tracks
  async getRecentTracks(req, res) {
    try {
      const listing = await getTracksListing({
        page: req.query.page,
        limit: req.query.limit,
        offset: req.query.offset,
        sortBy: req.query.sortBy,
        order: req.query.order,
        search: req.query.search,
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

      const updated = await setLovedFlag({ id, isLoved });
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

  // Health check endpoint
  async healthCheck(req, res) {
    try {
      // Check database connection
      const dbStatus = await Track.findOne().limit(1);
      
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        version: '1.0.0',
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

  // Find and remove duplicate tracks
  async removeDuplicates(req, res) {
    try {
      const dryRun = req.query.dryRun === 'true';
      
      // Find duplicates: same artist, title, connector within 5 minutes
      const duplicates = await Track.aggregate([
        {
          $group: {
            _id: {
              artist: '$artist',
              title: '$title',
              connector: '$connector',
              // Group by 5-minute time windows
              timeWindow: {
                $floor: {
                  $divide: [{ $toLong: '$scrobbledAt' }, 300000] // 5 minutes
                }
              }
            },
            tracks: { $push: '$ROOT' },
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
          artist: group._id.artist,
          title: group._id.title,
          connector: group._id.connector,
          totalCount: tracks.length,
          keepTrackId: keepTrack._id,
          removeTrackIds,
          keepTrackDate: keepTrack.scrobbledAt
        });
        
        if (!dryRun && removeTrackIds.length > 0) {
          await Track.deleteMany({ _id: { $in: removeTrackIds } });
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

  // Get duplicate statistics
  async getDuplicateStats(req, res) {
    try {
      const duplicateStats = await Track.aggregate([
        {
          $group: {
            _id: {
              artist: '$artist',
              title: '$title',
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
      
      const totalDuplicates = await Track.aggregate([
        {
          $group: {
            _id: {
              artist: '$artist',
              title: '$title',
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

  // Enrich track with Spotify data
  async enrichWithSpotifyData(track) {
    try {
      console.log(`🎵 Searching Spotify for: ${track.artist} - ${track.title}`);
      
      // Search for track on Spotify
      const spotifyData = await spotifyService.searchTrack(track.artist, track.title);
      
      if (spotifyData) {
        // เก็บข้อมูลเดิมเพื่อเปรียบเทียบ
        const originalData = {
          duration: track.duration,
          album: track.album,
          year: track.year,
          trackNumber: track.trackNumber
        };
        
        console.log(`✨ Found Spotify match for: ${track.artist} - ${track.title}`);
        console.log(`   Spotify ID: ${spotifyData.spotify_id}`);
        console.log(`   Album: ${spotifyData.album?.name || 'N/A'}`);
        console.log(`   Release Year: ${spotifyData.album?.release_date ? new Date(spotifyData.album.release_date).getFullYear() : 'N/A'}`);
        
        // สร้าง update object แทนการใช้ track.setSpotifyData
        const updateData = {
          spotify: {
            id: spotifyData.spotify_id,
            uri: spotifyData.spotify_uri,
            url: spotifyData.spotify_url,
            popularity: spotifyData.popularity,
            preview_url: spotifyData.preview_url,
            duration_ms: spotifyData.duration_ms,
            explicit: spotifyData.explicit,
            track_number: spotifyData.track_number,
            disc_number: spotifyData.disc_number,
            is_local: spotifyData.is_local,
            artist: spotifyData.artist,
            all_artists: spotifyData.all_artists,
            album: spotifyData.album,
            search_confidence: 1.0,
            fetched_at: new Date()
          },
          spotify_enriched: true,
          spotify_search_attempted: true,
          spotify_match_found: true
        };
        
        // เติมข้อมูลพื้นฐานที่ขาดหายไป
        const enrichedFields = [];
        
        if (spotifyData.duration_seconds && (!originalData.duration || originalData.duration === null)) {
          updateData.duration = spotifyData.duration_seconds;
          enrichedFields.push('duration');
          console.log(`🔧 Adding duration: ${spotifyData.duration_seconds}s`);
        }
        
        if (spotifyData.album?.name && (!originalData.album || originalData.album.trim() === '')) {
          updateData.album = spotifyData.album.name;
          enrichedFields.push('album');
          console.log(`🔧 Adding album: ${spotifyData.album.name}`);
        }
        
        if (spotifyData.album?.release_date && (!originalData.year || originalData.year === null)) {
          const releaseYear = new Date(spotifyData.album.release_date).getFullYear();
          if (!isNaN(releaseYear)) {
            updateData.year = releaseYear;
            enrichedFields.push('year');
            console.log(`🔧 Adding year: ${releaseYear}`);
          }
        }
        
        if (spotifyData.track_number && (!originalData.trackNumber || originalData.trackNumber === null)) {
          updateData.trackNumber = spotifyData.track_number;
          enrichedFields.push('trackNumber');
          console.log(`🔧 Adding track number: ${spotifyData.track_number}`);
        }
        
        // Optionally get audio features
        if (process.env.SPOTIFY_FETCH_AUDIO_FEATURES === 'true') {
          const audioFeatures = await spotifyService.getAudioFeatures(spotifyData.spotify_id);
          if (audioFeatures) {
            updateData['spotify.audio_features'] = audioFeatures;
            console.log(`🎧 Adding audio features`);
          }
        }
        
        // ใช้ findByIdAndUpdate เพื่อป้องกัน race condition
        const updatedTrack = await Track.findByIdAndUpdate(
          track._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );
        
        if (updatedTrack) {
          console.log(`✅ Spotify enrichment completed for: ${track.artist} - ${track.title}`);
          if (enrichedFields.length > 0) {
            console.log(`   Added fields: ${enrichedFields.join(', ')}`);
          } else {
            console.log(`   No missing fields to add (track data was already complete)`);
          }
        } else {
          console.log(`⚠️ Track not found during update: ${track._id}`);
        }
        
      } else {
        // Mark as searched but no match found
        await Track.findByIdAndUpdate(
          track._id,
          { 
            $set: {
              spotify_search_attempted: true,
              spotify_match_found: false,
              spotify_enriched: false
            }
          }
        );
        console.log(`❌ No Spotify match found for: ${track.artist} - ${track.title}`);
      }
      
    } catch (error) {
      console.error(`❌ Error enriching track ${track._id} with Spotify:`, error.message);
      
      // Mark as searched even if error occurred
      try {
        await Track.findByIdAndUpdate(
          track._id,
          { 
            $set: {
              spotify_search_attempted: true,
              spotify_match_found: false,
              spotify_enriched: false
            }
          }
        );
      } catch (saveError) {
        // ถ้า track ถูกลบไปแล้วหรือมี error อื่น ก็ไม่ต้องทำอะไร
        if (saveError.message.includes('Cast to ObjectId failed')) {
          console.log(`⚠️ Track ${track._id} no longer exists`);
        } else {
          console.error(`❌ Error saving search attempt status:`, saveError.message);
        }
      }
    }
  }

  // Enrich track with animated artwork from Apple Music
  async enrichWithAnimationData(track) {
    try {
      console.log(`🎬 Searching animated artwork for: ${track.artist} - ${track.title}`);
      
      // ค้นหาและดึง animated artwork
      const result = await appleMusicService.fetchAnimatedArtwork(
        track.title,
        track.artist,
        track.album || ''
      );
      
      if (result.success && result.animationUrl) {
        console.log(`✨ Found animated artwork for: ${track.artist} - ${track.title}`);
        console.log(`   Animation URL: ${result.animationUrl}`);
        
        // อัปเดต track ด้วย animationUrl
        const updateData = {
          animationUrl: result.animationUrl,
          animation_search_attempted: true,
          animation_match_found: true
        };
        
        // เก็บ Apple Music URL ไว้ด้วย (ถ้ามี)
        if (result.appleMusicUrl) {
          updateData.appleMusicUrl = result.appleMusicUrl;
        }
        
        const updatedTrack = await Track.findByIdAndUpdate(
          track._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );
        
        if (updatedTrack) {
          console.log(`✅ Animation enrichment completed for: ${track.artist} - ${track.title}`);
        } else {
          console.log(`⚠️ Track not found during animation update: ${track._id}`);
        }
        
      } else {
        // Mark as searched but no animated artwork found
        await Track.findByIdAndUpdate(
          track._id,
          { 
            $set: {
              animation_search_attempted: true,
              animation_match_found: false
            }
          }
        );
        console.log(`❌ No animated artwork found for: ${track.artist} - ${track.title}`);
        if (result.error) {
          console.log(`   Reason: ${result.error}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error enriching track ${track._id} with animation:`, error.message);
      
      // Mark as searched even if error occurred
      try {
        await Track.findByIdAndUpdate(
          track._id,
          { 
            $set: {
              animation_search_attempted: true,
              animation_match_found: false
            }
          }
        );
      } catch (saveError) {
        if (saveError.message.includes('Cast to ObjectId failed')) {
          console.log(`⚠️ Track ${track._id} no longer exists`);
        } else {
          console.error(`❌ Error saving animation search attempt status:`, saveError.message);
        }
      }
    }
  }

  // Update missing Spotify data for existing tracks
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
      console.log(`   Limit: ${limit}`);
      console.log(`   Missing data only: ${onlyMissingBasicData}`);
      console.log(`   Force update: ${forceUpdate}`);
      console.log(`   Priority fields: ${priorityFields}`);

      // Query สำหรับหา tracks ที่ต้องการ update
      let query = {};
      
      if (forceUpdate) {
        // Force mode: ทุก track ที่เป็น scrobble
        query = { eventType: 'scrobble' };
      } else if (onlyMissingBasicData) {
        // เฉพาะ tracks ที่ขาดข้อมูลพื้นฐาน
        const missingFieldConditions = [];

        if (priorityFieldsArray.includes('duration')) {
          missingFieldConditions.push({ duration: null }, { duration: { $exists: false } });
        }
        if (priorityFieldsArray.includes('album')) {
          missingFieldConditions.push({ album: null }, { album: '' }, { album: { $exists: false } });
        }
        if (priorityFieldsArray.includes('year')) {
          missingFieldConditions.push({ year: null }, { year: { $exists: false } });
        }
        if (priorityFieldsArray.includes('trackNumber')) {
          missingFieldConditions.push({ trackNumber: null }, { trackNumber: { $exists: false } });
        }

        if (missingFieldConditions.length === 0) {
          missingFieldConditions.push(
            { duration: null },
            { duration: { $exists: false } },
            { album: null },
            { album: '' },
            { album: { $exists: false } },
            { year: null },
            { year: { $exists: false } }
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
        };

        const andConditions = [];

        if (missingFieldConditions.length > 0) {
          andConditions.push({ $or: missingFieldConditions });
        }

        andConditions.push(searchRetryConditions);

        if (andConditions.length > 0) {
          query.$and = andConditions;
        }
      } else {
        // Default: tracks ที่ยังไม่ได้ search Spotify
        query = {
          eventType: 'scrobble',
          spotify_search_attempted: { $ne: true }
        };
      }

      // หา tracks ที่ต้อง update
      const tracksToUpdate = await Track.find(query)
        .sort({ scrobbledAt: -1 })
        .limit(limit)
        .select('_id artist title album duration year trackNumber spotify_search_attempted spotify_enriched');

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
          duration: 0,
          album: 0,
          year: 0,
          trackNumber: 0
        }
      };

      // Process tracks with rate limiting
      for (let i = 0; i < tracksToUpdate.length; i++) {
        const track = tracksToUpdate[i];
        
        try {
          console.log(`🔍 [${i + 1}/${tracksToUpdate.length}] Processing: ${track.artist} - ${track.title}`);
          
          // เก็บข้อมูลก่อน update เพื่อเปรียบเทียบ
          const beforeUpdate = {
            duration: track.duration,
            album: track.album,
            year: track.year,
            trackNumber: track.trackNumber
          };
          
          await this.enrichWithSpotifyData(track);
          
          // ตรวจสอบข้อมูลหลัง update
          const updatedTrack = await Track.findById(track._id);
          
          if (updatedTrack && updatedTrack.spotify_enriched) {
            stats.enriched++;
            
            // ตรวจสอบว่า field ไหนถูก update
            if (beforeUpdate.duration !== updatedTrack.duration && updatedTrack.duration) {
              stats.fields_updated.duration++;
            }
            if (beforeUpdate.album !== updatedTrack.album && updatedTrack.album) {
              stats.fields_updated.album++;
            }
            if (beforeUpdate.year !== updatedTrack.year && updatedTrack.year) {
              stats.fields_updated.year++;
            }
            if (beforeUpdate.trackNumber !== updatedTrack.trackNumber && updatedTrack.trackNumber) {
              stats.fields_updated.trackNumber++;
            }
            
            console.log(`✅ Successfully enriched: ${track.artist} - ${track.title}`);
          } else {
            stats.no_match++;
            console.log(`❌ No Spotify match: ${track.artist} - ${track.title}`);
          }
          
          stats.processed++;
          
          // Rate limiting delay
          if (i < tracksToUpdate.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
          }
          
        } catch (error) {
          stats.errors++;
          console.error(`❌ Error processing track ${track._id}: ${error.message}`);
        }
      }

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

  // Spotify integration endpoints
  async getSpotifyStatus(req, res) {
    try {
      const isConfigured = spotifyService.isConfigured();
      const cacheStats = spotifyService.getCacheStats();
      
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

  async getSpotifyStats(req, res) {
    try {
      const spotifyStats = await Track.getSpotifyStats();
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
        cache_stats: spotifyService.getCacheStats()
      });
    } catch (error) {
      console.error('❌ Error getting Spotify stats:', error);
      res.status(500).json({
        error: 'Failed to get Spotify statistics',
        message: error.message
      });
    }
  }

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
        tracksToEnrich = await Track.find({ eventType: 'scrobble' })
          .sort({ scrobbledAt: -1 })
          .limit(limit);
      } else {
        tracksToEnrich = await Track.findWithoutSpotifyData(limit);
      }
      
      if (tracksToEnrich.length === 0) {
        return res.status(200).json({
          message: 'No tracks need Spotify enrichment',
          processed: 0
        });
      }
      
      console.log(`🎵 Starting Spotify enrichment for ${tracksToEnrich.length} tracks...`);
      
      // Process tracks (with small delay to avoid rate limiting)
      let enriched = 0;
      let errors = 0;
      
      for (const track of tracksToEnrich) {
        try {
          await this.enrichWithSpotifyData(track);
          enriched++;
          
          // Small delay to avoid overwhelming Spotify API
          if (enriched < tracksToEnrich.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error(`❌ Failed to enrich track ${track._id}:`, error.message);
          errors++;
        }
      }
      
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

  async clearSpotifyCache(req, res) {
    try {
      const cacheStatsBefore = spotifyService.getCacheStats();
      spotifyService.clearCache();
      
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

  // Root endpoint with API documentation
  handleRoot(req, res) {
    const welcomeMessage = {
      message: 'Music Webhook Server',
      version: '1.0.0',
      framework: 'Express.js + Bun.js',
      features: [
        'Multiple webhook formats (Web Scrobbler, ListenBrainz, custom JSON)',
        'Duplicate prevention & Spotify enrichment queue',
        'In-memory Now Playing state with refresh endpoints',
        'ListenBrainz bulk import UI + API'
      ],
      endpoints: {
        webhook: {
          'POST /webhook/scrobble': 'Receive scrobble data from clients (Web Scrobbler, ListenBrainz import payloads)',
          'POST /webhook': 'Alternative scrobble endpoint'
        },
        nowPlaying: {
          'GET /api/nowplaying': 'Get current in-memory Now Playing snapshot',
          'POST /api/nowplaying/playing': 'Set or refresh Now Playing status (supports playing/paused/stopped)'
        },
        listeningData: {
        'GET /api/tracks?page=1&limit=50': 'List tracks with pagination/search',
        'PATCH /api/tracks': 'Update loved flag for a track (body: { id, isLoved })',
        'GET /api/tracks/top-artists?range=week': 'Top artists leaderboard',
        'GET /api/tracks/top-tracks?range=week': 'Top tracks leaderboard',
        'GET /api/track?artist=<name>&title=<title>': 'Single track analytics',
        'GET /api/albums?artist=<name>&album=<album>': 'Album analytics overview',
        'GET /api/artists/:name': 'Artist profile + timeline',
          'DELETE /api/tracks/range?start=<ISO>&end=<ISO>&dryRun=true': 'Delete tracks within a scrobbledAt date range (optional source/connector filters)',
          'GET /api/stats': 'Aggregate listening statistics',
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
          'POST /api/spotify/enrich?limit=10&force=true': 'Manual Spotify enrichment',
          'POST /api/spotify/update-missing?limit=50&missingOnly=true': 'Fill missing metadata using Spotify',
          'DELETE /api/spotify/cache': 'Clear Spotify search cache'
        }
      },
      notes: [
        'Use dryRun=true when deleting or deduplicating to preview the impact',
        'ListenBrainz imports automatically queue Spotify enrichment when configured',
        'Send POST requests to /webhook/scrobble with validated payloads to record new tracks'
      ]
    };

    res.status(200).json(welcomeMessage);
  }
}

export default new WebhookRoutes();
