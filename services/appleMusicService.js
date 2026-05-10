
import Cache from '../models/Cache.js';

class AppleMusicService {
  constructor() {
    this.cacheTimeout = 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  // Helper methods for caching
  createCacheKey(type, ...parts) {
    const rawKey = parts.map(p => (p || '').toString().toLowerCase().trim()).join('|');
    return `apple:${type}:${rawKey}`;
  }

  async checkCache(key) {
    try {
      const cached = await Cache.findOne({ key });
      if (cached) {
        // console.log(`🗄️ Apple Music cache hit: ${key}`);
        return cached.data;
      }
    } catch (err) {
      console.error('⚠️ Cache read error:', err.message);
    }
    return null;
  }

  async saveToCache(key, data, ttl = this.cacheTimeout) {
    try {
      await Cache.findOneAndUpdate(
        { key },
        { 
          data, 
          expiresAt: new Date(Date.now() + ttl) 
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error('⚠️ Cache write error:', err.message);
    }
  }

  /**
   * Fetch animated artwork URL and Apple Music metadata via
   * https://apple-music-artwork-search.vercel.app/api/search
   * Replaces the old two-step process (iTunes Search → dodoapps artwork).
   */
  async fetchAnimatedArtwork(songTitle, artist, album = '') {
    const searchTerm = `${artist} ${songTitle}`.trim();
    const cacheKey = this.createCacheKey('artwork', searchTerm);

    // 1. Check Cache
    const cachedResult = await this.checkCache(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const params = new URLSearchParams({
        term: searchTerm,
        limit: '1',
        animation: '1',
      });
      const apiUrl = `https://apple-music-artwork-search.vercel.app/api/search?${params.toString()}`;

      const response = await fetch(apiUrl, { signal: controller.signal });

      if (!response.ok) {
        const result = { success: false, error: `API returned status: ${response.status}` };
        await this.saveToCache(cacheKey, result, 24 * 60 * 60 * 1000);
        return result;
      }

      const data = await response.json();
      const results = Array.isArray(data.results) ? data.results : [];
      const match = results[0];

      if (!match) {
        const result = { success: false, error: 'No results found' };
        await this.saveToCache(cacheKey, result, 24 * 60 * 60 * 1000);
        return result;
      }

      const animationUrl = match.animation?.best || match.animation?.bestTall || null;
      const appleMusicUrl = match.trackViewUrl || match.collectionViewUrl || null;
      const trackArtUrl = match.artworkHi || match.artwork || null;

      if (animationUrl) {
        console.log(`🎬 Found animated artwork for "${searchTerm}": ${animationUrl}`);
      }

      const result = {
        success: !!animationUrl,
        animationUrl,
        appleMusicUrl,
        trackArtUrl,
        error: animationUrl ? null : 'No animated artwork available for this track',
      };

      // Cache success (30 days) or failure (1 day)
      const ttl = animationUrl
        ? this.cacheTimeout
        : 24 * 60 * 60 * 1000;
      await this.saveToCache(cacheKey, result, ttl);

      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        const result = { success: false, error: 'Artwork search timeout' };
        return result;
      }
      return { success: false, error: error.message };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Export singleton instance
const appleMusicService = new AppleMusicService();
export default appleMusicService;
