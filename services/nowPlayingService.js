// Optimized in-memory Now Playing state manager

class NowPlayingService {
  constructor() {
    this.current = null; // { track, status, startedAt, lastUpdate, progress }
    this._cachedStatus = null;
    this._cachedAt = 0;
  }

  // Normalize minimal track info from webhook trackData
  buildTrackInfo(trackData) {
    // Guard: if trackData is nullish, use empty object
    const d = trackData || {};
    return {
      title: d.title || d?.song?.processed?.track || d?.song?.parsed?.track || '',
      artist: d.artist || d?.song?.processed?.artist || d?.song?.parsed?.artist || '',
      album: d.album || d?.song?.processed?.album || d?.song?.parsed?.album || '',
      duration: d.duration || d?.song?.processed?.duration || d?.song?.parsed?.duration || null,
      connector: d.connector || d?.song?.connector?.label || d?.song?.connector?.id || '',
      originalUrl: d.originalUrl || d?.song?.parsed?.originUrl || '',
      trackArtUrl: d.trackArtUrl || d?.song?.metadata?.trackArtUrl || null,
      artistUrl: d.artistUrl || d?.song?.metadata?.artistUrl || null,
      trackUrl: d.trackUrl || d?.song?.metadata?.trackUrl || null,
      albumUrl: d.albumUrl || d?.song?.metadata?.albumUrl || null,
      animationUrl: d.animationUrl || d?.song?.metadata?.animationUrl || null,
      masterTallUrl: d.masterTallUrl || d?.song?.metadata?.masterTallUrl || null,
      isLovedInService: d.isLovedInService || d?.song?.metadata?.userloved || false,
      // pass through spotify summary if available on trackData
      spotify: d.spotify || null,
    };
  }

  /** Invalidate the 1-second response cache whenever state changes */
  _invalidateCache() {
    this._cachedStatus = null;
    this._cachedAt = 0;
  }

  setPlaying(trackData) {
    const now = new Date();
    const prev = this.current;
    const progress = typeof trackData.currentTime === 'number'
      ? trackData.currentTime
      : (prev?.status === 'paused' && typeof prev?.progressSeconds === 'number'
          ? prev.progressSeconds
          : null);
    const startedAt = trackData.startTimestamp
      ? new Date(trackData.startTimestamp)
      : (progress != null
          ? new Date(now.getTime() - progress * 1000)
          : now);

    this.current = {
      status: 'playing',
      track: this.buildTrackInfo(trackData),
      startedAt,
      lastUpdate: now,
      progressSeconds: progress,
      source: trackData.source || 'web-scrobbler',
    };
    this._invalidateCache();
  }

  setPaused(trackData) {
    // Guard: allow calling without arguments (from playerController)
    const d = trackData || {};
    const now = new Date();
    const progress = typeof d.currentTime === 'number' ? d.currentTime : (this.current?.progressSeconds ?? null);
    const hasTrackIdentity = !!(d.title && d.artist);
    this.current = {
      status: 'paused',
      track: hasTrackIdentity ? this.buildTrackInfo(d) : (this.current?.track || this.buildTrackInfo({})),
      startedAt: this.current?.startedAt || now,
      lastUpdate: now,
      progressSeconds: progress,
      source: d.source || this.current?.source || 'web-scrobbler',
    };
    this._invalidateCache();
  }

  setStopped(trackData) {
    // Guard: allow calling without arguments (from playerController)
    const d = trackData || {};
    const now = new Date();
    const hasTrackIdentity = !!(d.title && d.artist);
    const track = hasTrackIdentity ? this.buildTrackInfo(d) : (this.current?.track || this.buildTrackInfo({}));
    this.current = {
      status: 'stopped',
      track,
      startedAt: this.current?.startedAt || now,
      lastUpdate: now,
      progressSeconds: this.current?.progressSeconds ?? null,
      source: d.source || this.current?.source || 'web-scrobbler',
    };
    this._invalidateCache();
  }

  // Refresh current state as playing, optionally with new progress/duration
  refreshPlaying({ currentTime = null, duration = null } = {}) {
    const now = new Date();
    if (!this.current || !this.current.track) return;

    this.current.status = 'playing';
    this.current.lastUpdate = now;

    if (typeof duration === 'number' && duration > 0) {
      this.current.track.duration = duration;
    }

    if (typeof currentTime === 'number' && currentTime >= 0) {
      if (!this.current.startedAt) {
        this.current.startedAt = new Date(now.getTime() - currentTime * 1000);
      }
      this.current.progressSeconds = currentTime;
    } else if (typeof this.current.progressSeconds === 'number') {
      // Realign startedAt based on saved progress
      this.current.startedAt = new Date(now.getTime() - this.current.progressSeconds * 1000);
      // Recompute progress from startedAt
      if (this.current.startedAt) {
        this.current.progressSeconds = Math.floor((now - this.current.startedAt) / 1000);
      }
    }
    this._invalidateCache();
  }

  // Force set playing with provided track data
  forcePlaying(trackData = {}) {
    this.setPlaying(trackData || {});
  }

  updateFromEvent(trackData) {
    const type = (trackData.eventType || '').toLowerCase();

    if (type === 'paused') {
      this.setPaused(trackData);
      return;
    }
    if (type === 'stopped') {
      this.setStopped(trackData);
      return;
    }

    // Playing-style events require track identity
    if (!trackData.title || !trackData.artist) return;

    if (type === 'nowplaying' || type === 'resumed' || type === 'resumedplaying' || type === 'scrobble') {
      this.setPlaying(trackData);
    }
  }

  /**
   * Compute live status with expiry heuristics.
   * Uses a 1-second response cache to avoid recomputing on every poll.
   */
  getStatus() {
    // Return cached status if computed within the last second
    const nowMs = Date.now();
    if (this._cachedStatus && (nowMs - this._cachedAt) < 1000) {
      return this._cachedStatus;
    }

    if (!this.current) {
      const result = { playing: false, status: 'unknown', updatedAt: null, track: null };
      this._cachedStatus = result;
      this._cachedAt = nowMs;
      return result;
    }

    const now = new Date(nowMs);
    const { status, track, startedAt, lastUpdate, progressSeconds } = this.current;

    // Determine if stale
    let playing = status === 'playing';
    const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : null;

    if (playing) {
      if (track.duration && elapsed != null) {
        if (elapsed > track.duration) {
          playing = false;
        }
      } else if (now - lastUpdate > 10 * 60 * 1000) {
        // No duration; expire after 10 minutes since last update
        playing = false;
      }
    }

    // Compute dynamic progress (simplified)
    let progress = null;
    if (playing) {
      if (typeof progressSeconds === 'number') {
        progress = progressSeconds + Math.floor((now - lastUpdate) / 1000);
      } else if (elapsed != null) {
        progress = elapsed;
      }
      if (track.duration && typeof progress === 'number') {
        progress = Math.min(progress, track.duration);
      }
    } else if (status === 'paused') {
      progress = typeof progressSeconds === 'number' ? progressSeconds : elapsed;
    } else {
      // stopped or unknown — clamp to duration if available
      const base = typeof progressSeconds === 'number' ? progressSeconds : elapsed;
      progress = track.duration && base != null ? Math.min(base, track.duration) : base;
    }

    const result = {
      playing,
      status: playing ? 'playing' : (status === 'paused' ? 'paused' : 'stopped'),
      updatedAt: lastUpdate,
      startedAt,
      elapsed,
      progress,
      track,
      source: this.current.source,
    };

    this._cachedStatus = result;
    this._cachedAt = nowMs;
    return result;
  }
}

const nowPlayingService = new NowPlayingService();
export default nowPlayingService;
