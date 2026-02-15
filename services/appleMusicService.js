
import Cache from '../models/Cache.js';

class AppleMusicService {
  constructor() {
    this.searchTimeout = 5000;
    this.artworkTimeout = 20000;
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

  // ... (Normalization and string manipulation methods remain unchanged)
  baseNormalize(value) {
    return (value ?? '').toString().toLowerCase().trim();
  }

  stripParentheses(value) {
    return this.baseNormalize(value).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  }

  sanitizeTrackOrAlbum(value) {
    return this.stripParentheses(value)
      .replace(/ร่วมกับ/gi, ' ')
      .replace(/\b(feat\.?|ft\.?|with)\b/gi, ' ')
      .replace(/\b(explicit|clean)\b/gi, ' ')
      .replace(/\b(ver\.?|version)\b/gi, ' ')
      .replace(/[-–—]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractParenthesisValues(value) {
    const matches = [...(value ?? '').toString().matchAll(/\(([^)]+)\)/g)];
    return matches.map((match) => this.baseNormalize(match[1]).replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  createComparableValues(value, { removeDecorations = false } = {}) {
    const normalized = this.baseNormalize(value);
    if (!normalized) {
      return [];
    }

    const values = new Set();
    const addValue = (val) => {
      if (!val) return;
      const trimmed = val.replace(/\s+/g, ' ').trim();
      if (!trimmed) return;
      values.add(trimmed);
      values.add(trimmed.replace(/\s+/g, ''));
    };

    addValue(normalized);

    const noParentheses = normalized.replace(/\([^)]*\)/g, ' ');
    addValue(noParentheses);

    normalized.split(/[,/&]/).forEach((part) => addValue(part));
    normalized.split(/[-–—]/).forEach((part) => addValue(part));

    this.extractParenthesisValues(value).forEach((part) => addValue(part));

    if (removeDecorations) {
      addValue(this.sanitizeTrackOrAlbum(value));
    }

    return Array.from(values);
  }

  valuesOverlap(aValues, bValues) {
    if (!aValues.length || !bValues.length) {
      return false;
    }
    return aValues.some((aVal) =>
      bValues.some((bVal) => aVal && bVal && (aVal === bVal || aVal.includes(bVal) || bVal.includes(aVal)))
    );
  }

  buildSearchTerms(songTitle, artist, album) {
    const terms = new Set();
    const addTerm = (...parts) => {
      const term = parts
        .flat()
        .map((part) => (part ?? '').toString().trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (term) {
        terms.add(term);
      }
    };

    const sanitizedArtist = this.stripParentheses(artist);
    const sanitizedTrack = this.sanitizeTrackOrAlbum(songTitle);
    const sanitizedAlbum = this.sanitizeTrackOrAlbum(album);
    const artistAlternatives = this.extractParenthesisValues(artist);

    addTerm(artist, album, songTitle);
    addTerm(artist, songTitle);
    addTerm(artist, sanitizedTrack);
    addTerm(sanitizedArtist, sanitizedTrack);
    addTerm(sanitizedArtist, sanitizedAlbum, sanitizedTrack);
    addTerm(sanitizedArtist, sanitizedAlbum);
    addTerm(sanitizedTrack);

    artistAlternatives.forEach((alt) => {
      addTerm(alt, sanitizedTrack);
      addTerm(alt, sanitizedAlbum, sanitizedTrack);
    });

    if (sanitizedAlbum) {
      addTerm(sanitizedAlbum, sanitizedTrack);
    }

    return Array.from(terms);
  }

  async executeSearch(term, country) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.searchTimeout);
    const encodedTerm = encodeURIComponent(term);

    try {
      const countryParam = country ? `&country=${country}` : '';
      const response = await fetch(
        `https://itunes.apple.com/search?term=${encodedTerm}&entity=musicTrack&media=music&limit=4${countryParam}`,
        { signal: controller.signal }
      );

      if (!response.ok) {
        return { error: `iTunes API returned status: ${response.status}` };
      }

      const data = await response.json();
      const results = Array.isArray(data.results) ? data.results : [];
      return { results };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { error: 'iTunes search timeout' };
      }
      return { error: error.message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  findBestMatch(results, artist, songTitle, album) {
    if (!results.length) {
      return null;
    }

    const targetArtistValues = this.createComparableValues(artist);
    const targetTrackValues = this.createComparableValues(songTitle, { removeDecorations: true });
    const targetAlbumValues = album ? this.createComparableValues(album, { removeDecorations: true }) : [];

    const evaluateItem = (item) => {
      const itemArtistValues = this.createComparableValues(item.artistName);
      const itemTrackValues = this.createComparableValues(item.trackName, { removeDecorations: true });
      const itemAlbumValues = this.createComparableValues(item.collectionName, { removeDecorations: true });

      const artistMatch = this.valuesOverlap(targetArtistValues, itemArtistValues);
      const trackMatch = this.valuesOverlap(targetTrackValues, itemTrackValues);
      const albumMatch = !targetAlbumValues.length || this.valuesOverlap(targetAlbumValues, itemAlbumValues);

      return { artistMatch, trackMatch, albumMatch };
    };

    const rankedResults = results.map((item) => {
      const { artistMatch, trackMatch, albumMatch } = evaluateItem(item);
      const score =
        (artistMatch ? 3 : 0) +
        (trackMatch ? 5 : 0) +
        (albumMatch ? 1 : 0);
      return { item, artistMatch, trackMatch, albumMatch, score };
    });

    const perfectMatch = rankedResults.find(
      ({ artistMatch, trackMatch, albumMatch }) => artistMatch && trackMatch && albumMatch
    );
    if (perfectMatch) {
      return perfectMatch.item;
    }

    const strongMatch = rankedResults
      .filter(({ trackMatch }) => trackMatch)
      .sort((a, b) => b.score - a.score)[0];
    return strongMatch ? strongMatch.item : results[0];
  }

  /**
   * ค้นหา Apple Music URL จาก iTunes API (Optimize with caching and parallel search)
   */
  async searchAppleMusicUrl(songTitle, artist, album = '') {
    const cacheKey = this.createCacheKey('url', songTitle, artist, album);
    
    // 1. Check Cache
    const cachedResult = await this.checkCache(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const searchTerms = this.buildSearchTerms(songTitle, artist, album);
      if (!searchTerms.length) {
        return { success: false, error: 'No search terms provided' };
      }

      const countryPriority = ['us', 'th', 'jp', 'kr'];
      
      // 2. Parallel Search Strategy
      // Instead of deep nesting, we race countries for each term batch or vice versa.
      // Better strategy: Try primary terms in ALL countries in parallel.
      
      // Limit terms to first 3 to avoid spamming API too much in parallel
      const topTerms = searchTerms.slice(0, 3);
      
      let foundUrl = null;
      let lastError = null;

      // Helper to search a single term in a single country
      const searchOne = async (term, country) => {
        const { results = [], error } = await this.executeSearch(term, country);
        if (error) throw new Error(error);
        if (!results.length) return null;
        
        const match = this.findBestMatch(results, artist, songTitle, album);
        return match?.trackViewUrl || null;
      };

      // Execute parallel search
      // We process terms sequentially, but countries in parallel for each term
      for (const term of topTerms) {
        const promises = countryPriority.map(country => searchOne(term, country));
        
        // We want the FIRST successful non-null result. 
        // Promise.any would return the first fulfilled, but we need the first *successful value*.
        // Detailed parallel logic:
        const results = await Promise.allSettled(promises);
        
        // Check for any successful match
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            foundUrl = result.value;
            break; 
          }
        }
        
        if (foundUrl) break;
      }

      if (foundUrl) {
        const result = { success: true, url: foundUrl };
        await this.saveToCache(cacheKey, result);
        return result;
      }

      const result = { success: false, error: 'No results found after parallel optimized search' };
      // Cache failure logic can be debated, let's cache it for a shorter time (e.g., 1 day)
      await this.saveToCache(cacheKey, result, 24 * 60 * 60 * 1000);
      return result;

    } catch (error) {
       // ... existing error handling ...
       return { success: false, error: error.message };
    }
  }

  /**
   * ดึง animated artwork URL (with caching)
   */
  async getAnimatedArtwork(appleMusicUrl) {
    const cacheKey = this.createCacheKey('artwork', appleMusicUrl);

    // 1. Check Cache
    const cached = await this.checkCache(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.artworkTimeout);

    try {
      const response = await fetch('https://clients.dodoapps.io/playlist-precis/playlist-artwork.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          url: appleMusicUrl,
          animation: 'true'
        }).toString(),
        signal: controller.signal
      });

      if (!response.ok) {
         // ... error handling
         return { success: false, error: `API status: ${response.status}` };
      }

      const data = await response.json();
      let result;

      if (data.animatedUrl1080 || data.animatedUrl) {
        result = { success: true, url: data.animatedUrl1080 || data.animatedUrl };
        // Cache success forever (or 30 days)
        await this.saveToCache(cacheKey, result);
        return result;
      }

      result = { success: false, error: 'No animated artwork available' };
      // Cache failure (maybe shorter time? 7 days)
      await this.saveToCache(cacheKey, result, 7 * 24 * 60 * 60 * 1000);
      return result;

    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Animated artwork fetch timeout' };
      }
      return { success: false, error: error.message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchAnimatedArtwork(songTitle, artist, album = '') {
    try {
      // Step 1: ค้นหา Apple Music URL
      const searchResult = await this.searchAppleMusicUrl(songTitle, artist, album);
      
      if (!searchResult.success || !searchResult.url) {
        return { 
          success: false, 
          error: searchResult.error || 'Could not find Apple Music URL' 
        };
      }

      // console.log(`🍎 Found Apple Music URL for "${artist} - ${songTitle}": ${searchResult.url}`);

      // Step 2: ดึง animated artwork
      const artworkResult = await this.getAnimatedArtwork(searchResult.url);
      
      if (!artworkResult.success || !artworkResult.url) {
        return { 
          success: false, 
          appleMusicUrl: searchResult.url,
          error: artworkResult.error || 'No animated artwork available' 
        };
      }

      console.log(`🎬 Found animated artwork for "${artist} - ${songTitle}": ${artworkResult.url}`);

      return {
        success: true,
        animationUrl: artworkResult.url,
        appleMusicUrl: searchResult.url
      };
    } catch (error) {
      console.error(`❌ Error fetching animated artwork for "${artist} - ${songTitle}":`, error.message);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
const appleMusicService = new AppleMusicService();
export default appleMusicService;
