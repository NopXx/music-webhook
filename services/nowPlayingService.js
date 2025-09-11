// Simple in-memory Now Playing state manager

class NowPlayingService {
  constructor() {
    this.current = null; // { track, status, startedAt, lastUpdate, progress }
  }

  // Normalize minimal track info from webhook trackData
  buildTrackInfo(trackData) {
    return {
      title: trackData.title || trackData?.song?.processed?.track || trackData?.song?.parsed?.track || '',
      artist: trackData.artist || trackData?.song?.processed?.artist || trackData?.song?.parsed?.artist || '',
      album: trackData.album || trackData?.song?.processed?.album || trackData?.song?.parsed?.album || '',
      duration: trackData.duration || trackData?.song?.processed?.duration || trackData?.song?.parsed?.duration || null,
      connector: trackData.connector || trackData?.song?.connector?.label || trackData?.song?.connector?.id || '',
      originalUrl: trackData.originalUrl || trackData?.song?.parsed?.originUrl || '',
      trackArtUrl: trackData.trackArtUrl || trackData?.song?.metadata?.trackArtUrl || null,
      artistUrl: trackData.artistUrl || trackData?.song?.metadata?.artistUrl || null,
      trackUrl: trackData.trackUrl || trackData?.song?.metadata?.trackUrl || null,
      albumUrl: trackData.albumUrl || trackData?.song?.metadata?.albumUrl || null,
      isLovedInService: trackData.isLovedInService || trackData?.song?.metadata?.userloved || false,
      // pass through spotify summary if available on trackData
      spotify: trackData.spotify || null,
    };
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
  }

  setPaused(trackData) {
    const now = new Date();
    const progress = typeof trackData.currentTime === 'number' ? trackData.currentTime : (this.current?.progressSeconds ?? null);
    this.current = {
      status: 'paused',
      track: this.buildTrackInfo(trackData),
      startedAt: this.current?.startedAt || now,
      lastUpdate: now,
      progressSeconds: progress,
      source: trackData.source || 'web-scrobbler',
    };
  }

  setStopped(trackData) {
    const now = new Date();
    // retain last track but mark stopped
    const track = this.buildTrackInfo(trackData);
    this.current = {
      status: 'stopped',
      track,
      startedAt: this.current?.startedAt || now,
      lastUpdate: now,
      progressSeconds: this.current?.progressSeconds ?? null,
      source: trackData.source || 'web-scrobbler',
    };
  }

  // Refresh current state as playing, optionally with new progress/duration
  refreshPlaying({ currentTime = null, duration = null } = {}) {
    const now = new Date();
    if (!this.current || !this.current.track) return;

    // Ensure status is playing
    this.current.status = 'playing';
    this.current.lastUpdate = now;

    if (typeof duration === 'number' && duration > 0) {
      this.current.track.duration = duration;
    }

    if (typeof currentTime === 'number' && currentTime >= 0) {
      // If we have a startedAt, keep it; otherwise infer from currentTime
      if (!this.current.startedAt) {
        this.current.startedAt = new Date(now.getTime() - currentTime * 1000);
      }
      this.current.progressSeconds = currentTime;
    } else {
      // If we are resuming from paused and we had a saved progress, reset startedAt
      if (this.current.status === 'playing' && typeof this.current.progressSeconds === 'number') {
        // If we were paused previously, startedAt might be too old. Realign.
        this.current.startedAt = new Date(now.getTime() - this.current.progressSeconds * 1000);
      }
      // Fallback: recompute progress from startedAt if available
      if (this.current.startedAt) {
        this.current.progressSeconds = Math.floor((now - this.current.startedAt) / 1000);
      }
    }
  }

  // Force set playing with provided track data
  forcePlaying(trackData = {}) {
    this.setPlaying(trackData || {});
  }

  updateFromEvent(trackData) {
    const type = (trackData.eventType || '').toLowerCase();
    if (!trackData.title || !trackData.artist) return; // ignore invalid

    if (type === 'nowplaying' || type === 'resumed') {
      this.setPlaying(trackData);
    } else if (type === 'paused') {
      this.setPaused(trackData);
    } else if (type === 'stopped' || type === 'scrobble') {
      this.setStopped(trackData);
    }
  }

  // Compute live status with expiry heuristics
  getStatus() {
    if (!this.current) {
      return { playing: false, status: 'unknown', updatedAt: null, track: null };
    }

    const now = new Date();
    const { status, track, startedAt, lastUpdate, progressSeconds } = this.current;

    // Determine if stale. If playing and duration known, consider done after duration + 15s
    let playing = status === 'playing';
    let elapsed = null;
    if (startedAt) {
      elapsed = Math.floor((now - startedAt) / 1000);
    }

    if (playing) {
      if (track.duration && elapsed != null) {
        // Recalculate strictly by elapsed > duration
        if (elapsed > track.duration) {
          playing = false;
        }
      } else {
        // No duration; expire after 10 minutes since last update
        if (now - lastUpdate > 10 * 60 * 1000) {
          playing = false;
        }
      }
    }

    // Compute dynamic progress
    let progress = null;
    if (playing) {
      if (typeof progressSeconds === 'number') {
        const delta = Math.floor((now - lastUpdate) / 1000);
        progress = progressSeconds + delta;
      } else if (elapsed != null) {
        progress = elapsed;
      }
      if (track.duration && typeof progress === 'number') {
        progress = Math.min(progress, track.duration);
      }
    } else if (status === 'paused') {
      progress = typeof progressSeconds === 'number' ? progressSeconds : elapsed;
    } else {
      // stopped or unknown
      if (track.duration) {
        const base = (elapsed != null ? elapsed : (typeof progressSeconds === 'number' ? progressSeconds : track.duration));
        progress = Math.min(base, track.duration);
      } else {
        progress = typeof progressSeconds === 'number' ? progressSeconds : (elapsed != null ? elapsed : null);
      }
    }

    return {
      playing,
      status: playing ? 'playing' : status === 'paused' ? 'paused' : 'stopped',
      updatedAt: lastUpdate,
      startedAt,
      elapsed,
      progress,
      track,
      source: this.current.source,
    };
  }
}

const nowPlayingService = new NowPlayingService();
export default nowPlayingService;
