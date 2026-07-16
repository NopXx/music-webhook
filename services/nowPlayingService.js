// Multi-source, multi-user Now Playing state manager.
//
// State is partitioned per user. Within each user, every scrobbler source
// (web-scrobbler, listenbrainz, custom apps, ...) keeps its own slot. A single
// "primary" source per user is surfaced through getStatus(userId), chosen with
// a sticky policy so concurrent scrobblers don't flicker the displayed track.
import redis from '../config/redis.js';

const REDIS_PREFIX = 'nowplaying:state:';      // per-user: nowplaying:state:<userId>
const REDIS_TTL = 86400;                       // 1 day Redis TTL
const STALE_MS = 60 * 1000;                    // heartbeat window for "active"
const CLEANUP_MS = 30 * 60 * 1000;             // drop a source after this idle
const HYDRATE_STALE_MS = 10 * 60 * 1000;

const reviveEntry = (entry) => {
  if (!entry) return null;
  if (entry.startedAt) entry.startedAt = new Date(entry.startedAt);
  if (entry.lastUpdate) entry.lastUpdate = new Date(entry.lastUpdate);
  return entry;
};

/**
 * Holds the now-playing state for a single user. All the sticky-primary,
 * progress, and caching logic lives here; the parent service routes by userId.
 */
class UserNowPlaying {
  constructor(onChange) {
    this.sources = new Map();       // sourceKey -> sourceState
    this._primaryKey = null;
    this._version = 0;
    this._cachedStatus = null;
    this._cachedAt = 0;
    this._onChange = onChange || (() => {});
  }

  get current() {
    return this._primaryKey ? (this.sources.get(this._primaryKey) || null) : null;
  }

  _sourceKey(trackData) {
    const d = trackData || {};
    const src = d.source || 'unknown';
    const conn = d.connector || d?.song?.connector?.label || '';
    return conn ? `${src}:${conn}`.toLowerCase() : src.toLowerCase();
  }

  _persist() {
    this._onChange();
  }

  serialize() {
    return {
      sources: Array.from(this.sources.entries()),
      _primaryKey: this._primaryKey,
      _version: this._version,
    };
  }

  /** Load state produced by serialize(). Returns true if any source survived. */
  loadFrom(state) {
    if (!state) return false;
    const now = Date.now();

    if (Array.isArray(state.sources)) {
      for (const [key, entry] of state.sources) {
        const revived = reviveEntry(entry);
        if (!revived) continue;
        const age = now - (revived.lastUpdate?.getTime() || 0);
        if (age > HYDRATE_STALE_MS) continue;
        this.sources.set(key, revived);
      }
      this._primaryKey = state._primaryKey && this.sources.has(state._primaryKey)
        ? state._primaryKey
        : null;
      this._version = state._version || 0;
      if (this.sources.size > 0) {
        this._recomputePrimary();
        return true;
      }
      return false;
    }

    // Legacy single-source format: { current, _version }
    if (state.current) {
      const revived = reviveEntry(state.current);
      const age = now - (revived.lastUpdate?.getTime() || 0);
      if (age > HYDRATE_STALE_MS) return false;
      const key = String(revived.source || 'unknown').toLowerCase();
      this.sources.set(key, revived);
      this._primaryKey = key;
      this._version = state._version || 0;
      return true;
    }
    return false;
  }

  _isActive(entry) {
    if (!entry) return false;
    if (entry.status !== 'playing') return false;
    const age = Date.now() - (entry.lastUpdate?.getTime?.() || 0);
    return age <= STALE_MS;
  }

  _isFresh(entry) {
    if (!entry) return false;
    const age = Date.now() - (entry.lastUpdate?.getTime?.() || 0);
    return age <= STALE_MS;
  }

  _recomputePrimary() {
    const prev = this._primaryKey;
    this._cleanupStale();

    if (prev && this._isActive(this.sources.get(prev))) {
      return;
    }

    let bestKey = null;
    let bestUpdate = -Infinity;
    for (const [key, entry] of this.sources) {
      if (!this._isActive(entry)) continue;
      const t = entry.lastUpdate?.getTime?.() || 0;
      if (t > bestUpdate) { bestUpdate = t; bestKey = key; }
    }

    if (!bestKey) {
      for (const [key, entry] of this.sources) {
        if (!this._isFresh(entry)) continue;
        const t = entry.lastUpdate?.getTime?.() || 0;
        if (t > bestUpdate) { bestUpdate = t; bestKey = key; }
      }
    }

    if (!bestKey && prev && this.sources.has(prev)) {
      bestKey = prev;
    } else if (!bestKey) {
      for (const [key, entry] of this.sources) {
        const t = entry.lastUpdate?.getTime?.() || 0;
        if (t > bestUpdate) { bestUpdate = t; bestKey = key; }
      }
    }

    if (bestKey !== prev) {
      this._primaryKey = bestKey;
    }
  }

  _cleanupStale() {
    const now = Date.now();
    for (const [key, entry] of this.sources) {
      const age = now - (entry.lastUpdate?.getTime?.() || 0);
      if (age > CLEANUP_MS) this.sources.delete(key);
    }
  }

  attachEnrichment({ animationUrl, appleMusicUrl }) {
    const primary = this.current;
    if (!primary?.track) return;
    if (animationUrl) primary.track.animationUrl = animationUrl;
    if (appleMusicUrl) primary.track.appleMusicUrl = appleMusicUrl;
    this._invalidateCache();
    this._persist();
  }

  getVersion() {
    return this._version;
  }

  setIdle() {
    this.sources.clear();
    this._primaryKey = null;
    this._version++;
    this._invalidateCache();
    this._persist();
  }

  buildTrackInfo(trackData) {
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
      spotify: d.spotify || null,
    };
  }

  _invalidateCache() {
    this._cachedStatus = null;
    this._cachedAt = 0;
  }

  setPlaying(trackData) {
    const now = new Date();
    const key = this._sourceKey(trackData);
    const prev = this.sources.get(key);

    let progress;
    if (typeof trackData.currentTime === 'number') {
      progress = trackData.currentTime;
    } else if (prev?.status === 'paused' && typeof prev?.progressSeconds === 'number') {
      progress = prev.progressSeconds;
    } else if (prev?.startedAt) {
      progress = Math.floor((now - prev.startedAt) / 1000);
      if (prev.track?.duration && progress > prev.track.duration) {
        progress = prev.track.duration;
      }
    } else {
      progress = null;
    }

    const startedAt = trackData.startTimestamp
      ? new Date(trackData.startTimestamp)
      : (progress != null
          ? new Date(now.getTime() - progress * 1000)
          : now);

    this.sources.set(key, {
      status: 'playing',
      track: this.buildTrackInfo(trackData),
      startedAt,
      lastUpdate: now,
      progressSeconds: progress,
      source: trackData.source || trackData.connector || key,
    });
    this._version++;
    this._recomputePrimary();
    this._invalidateCache();
    this._persist();
  }

  setPaused(trackData) {
    const d = trackData || {};
    const now = new Date();
    const explicitKey = d.source || d.connector ? this._sourceKey(d) : null;
    const key = explicitKey || this._primaryKey;
    if (!key) return;

    const prev = this.sources.get(key);
    const explicitProgress = typeof d.currentTime === 'number' ? d.currentTime : null;
    const progress = explicitProgress ??
      (prev?.startedAt ? Math.floor((now - prev.startedAt) / 1000) :
       (prev?.progressSeconds ?? null));

    const hasTrackIdentity = !!(d.title && d.artist);
    this.sources.set(key, {
      status: 'paused',
      track: hasTrackIdentity ? this.buildTrackInfo(d) : (prev?.track || this.buildTrackInfo({})),
      startedAt: prev?.startedAt || now,
      lastUpdate: now,
      progressSeconds: progress,
      source: d.source || d.connector || prev?.source || key,
    });
    this._version++;
    this._recomputePrimary();
    this._invalidateCache();
    this._persist();
  }

  setStopped(trackData) {
    const d = trackData || {};
    const now = new Date();
    const explicitKey = d.source || d.connector ? this._sourceKey(d) : null;
    const key = explicitKey || this._primaryKey;
    if (!key) return;

    const prev = this.sources.get(key);
    const progress = prev?.startedAt
      ? Math.floor((now - prev.startedAt) / 1000)
      : (prev?.progressSeconds ?? null);

    const hasTrackIdentity = !!(d.title && d.artist);
    const track = hasTrackIdentity ? this.buildTrackInfo(d) : (prev?.track || this.buildTrackInfo({}));
    this.sources.set(key, {
      status: 'stopped',
      track,
      startedAt: prev?.startedAt || now,
      lastUpdate: now,
      progressSeconds: progress,
      source: d.source || d.connector || prev?.source || key,
    });
    this._version++;
    this._recomputePrimary();
    this._invalidateCache();
    this._persist();
  }

  refreshPlaying({ currentTime = null, duration = null } = {}) {
    const now = new Date();
    const primary = this.current;
    if (!primary || !primary.track) return;

    primary.status = 'playing';
    primary.lastUpdate = now;

    if (typeof duration === 'number' && duration > 0) {
      primary.track.duration = duration;
    }

    if (typeof currentTime === 'number' && currentTime >= 0) {
      if (!primary.startedAt) {
        primary.startedAt = new Date(now.getTime() - currentTime * 1000);
      }
      primary.progressSeconds = currentTime;
    } else if (typeof primary.progressSeconds === 'number') {
      primary.startedAt = new Date(now.getTime() - primary.progressSeconds * 1000);
      if (primary.startedAt) {
        primary.progressSeconds = Math.floor((now - primary.startedAt) / 1000);
      }
    }
    this._version++;
    this._recomputePrimary();
    this._invalidateCache();
    this._persist();
  }

  updateFromEvent(trackData) {
    const type = (trackData.eventType || '').toLowerCase();
    if (type === 'paused') { this.setPaused(trackData); return; }
    if (type === 'stopped') { this.setStopped(trackData); return; }
    if (!trackData.title || !trackData.artist) return;
    if (type === 'nowplaying' || type === 'resumed' || type === 'resumedplaying' || type === 'scrobble') {
      this.setPlaying(trackData);
    }
  }

  getStatus() {
    const nowMs = Date.now();
    if (this._cachedStatus && (nowMs - this._cachedAt) < 1000) {
      return this._cachedStatus;
    }

    this._recomputePrimary();

    const primary = this.current;
    if (!primary) {
      const result = { playing: false, status: 'unknown', updatedAt: null, track: null };
      this._cachedStatus = result;
      this._cachedAt = nowMs;
      return result;
    }

    const now = new Date(nowMs);
    const { status, track, startedAt, lastUpdate, progressSeconds } = primary;

    let playing = status === 'playing';
    const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : null;

    if (playing) {
      if (track.duration && elapsed != null) {
        if (elapsed > track.duration) playing = false;
      } else if (now - lastUpdate > 10 * 60 * 1000) {
        playing = false;
      }
    }

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
      const base = typeof progressSeconds === 'number' ? progressSeconds : elapsed;
      progress = track.duration && base != null ? Math.min(base, track.duration) : base;
    }

    const result = {
      playing,
      status: playing ? 'playing' : (status === 'paused' ? 'paused' : (status === 'stopped' ? 'stopped' : 'idle')),
      updatedAt: lastUpdate,
      startedAt,
      elapsed,
      progress,
      track,
      source: primary.source,
    };

    this._cachedStatus = result;
    this._cachedAt = nowMs;
    return result;
  }
}

const IDLE_STATUS = { playing: false, status: 'unknown', updatedAt: null, track: null };

/**
 * Routes now-playing operations to a per-user UserNowPlaying instance and
 * handles per-user Redis persistence + hydration.
 */
class NowPlayingService {
  constructor() {
    this.users = new Map();   // userId -> UserNowPlaying
  }

  _key(userId) {
    return String(userId);
  }

  _persistUser(userId, state) {
    if (!redis || redis.status !== 'ready') return;
    const payload = JSON.stringify(state.serialize());
    redis.set(`${REDIS_PREFIX}${this._key(userId)}`, payload, 'EX', REDIS_TTL).catch(() => {});
  }

  /** Get (or lazily create) the state container for a user. */
  _get(userId) {
    const key = this._key(userId);
    let state = this.users.get(key);
    if (!state) {
      state = new UserNowPlaying(() => this._persistUser(key, state));
      this.users.set(key, state);
    }
    return state;
  }

  /** Get a user's state only if it already exists (no side effects). */
  _peek(userId) {
    return this.users.get(this._key(userId)) || null;
  }

  // ── Delegated, user-scoped API ───────────────
  setPlaying(userId, trackData) { this._get(userId).setPlaying(trackData); }
  setPaused(userId, trackData) { this._get(userId).setPaused(trackData); }
  setStopped(userId, trackData) { this._get(userId).setStopped(trackData); }
  refreshPlaying(userId, opts) { this._get(userId).refreshPlaying(opts); }
  updateFromEvent(userId, trackData) { this._get(userId).updateFromEvent(trackData); }
  attachEnrichment(userId, data) { this._get(userId).attachEnrichment(data); }
  setIdle(userId) { this._get(userId).setIdle(); }

  getVersion(userId) {
    const state = this._peek(userId);
    return state ? state.getVersion() : 0;
  }

  /** The raw primary entry for a user (used by enrichment guards). */
  getCurrent(userId) {
    const state = this._peek(userId);
    return state ? state.current : null;
  }

  getStatus(userId) {
    const state = this._peek(userId);
    return state ? state.getStatus() : { ...IDLE_STATUS };
  }

  /** Restore all users' state from Redis on boot. */
  async hydrate() {
    if (!redis || redis.status !== 'ready') return;
    try {
      const keys = await redis.keys(`${REDIS_PREFIX}*`);
      let restored = 0;
      for (const redisKey of keys) {
        const userId = redisKey.slice(REDIS_PREFIX.length);
        const raw = await redis.get(redisKey);
        if (!raw) continue;
        let parsed;
        try { parsed = JSON.parse(raw); } catch { continue; }
        const state = new UserNowPlaying(() => this._persistUser(userId, state));
        if (state.loadFrom(parsed)) {
          this.users.set(userId, state);
          restored++;
        }
      }
      if (restored > 0) {
        console.log(`♻️ NowPlaying restored state for ${restored} user(s) from Redis`);
      }
    } catch (err) {
      console.warn('⚠️ NowPlaying hydration failed:', err.message);
    }
  }
}

const nowPlayingService = new NowPlayingService();
export default nowPlayingService;
