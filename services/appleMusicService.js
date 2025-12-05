/**
 * Apple Music Service
 * ใช้สำหรับค้นหา Apple Music URL และดึง animated artwork
 * อ้างอิงจาก background.js ใน Chrome extension
 */

class AppleMusicService {
  constructor() {
    this.searchTimeout = 5000;
    this.artworkTimeout = 10000;
  }

  // Normalize และเตรียม string สำหรับเปรียบเทียบ
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
   * ค้นหา Apple Music URL จาก iTunes API
   * @param {string} songTitle - ชื่อเพลง
   * @param {string} artist - ชื่อศิลปิน
   * @param {string} album - ชื่ออัลบั้ม (optional)
   * @returns {Promise<{success: boolean, url?: string, error?: string}>}
   */
  async searchAppleMusicUrl(songTitle, artist, album = '') {
    try {
      const searchTerms = this.buildSearchTerms(songTitle, artist, album);
      if (!searchTerms.length) {
        return { success: false, error: 'No search terms provided' };
      }

      const countryPriority = ['us', 'kr', 'th', 'jp'];
      let lastResults = [];
      let lastError = null;

      for (const country of countryPriority) {
        for (const term of searchTerms) {
          const { results = [], error } = await this.executeSearch(term, country);
          if (error) {
            lastError = error;
            continue;
          }

          if (!results.length) {
            continue;
          }

          const matchedItem = this.findBestMatch(results, artist, songTitle, album);
          if (matchedItem?.trackViewUrl) {
            return { success: true, url: matchedItem.trackViewUrl };
          }

          if (!lastResults.length) {
            lastResults = results;
          }
        }

        if (lastResults.length) {
          break;
        }
      }

      const fallbackUrl = lastResults[0]?.trackViewUrl;
      if (fallbackUrl) {
        return { success: true, url: fallbackUrl };
      }

      return { success: false, error: lastError || 'No results found' };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'iTunes search timeout' };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * ดึง animated artwork URL จาก Apple Music URL
   * ใช้ API จาก dodoapps.io
   * @param {string} appleMusicUrl - Apple Music URL
   * @returns {Promise<{success: boolean, url?: string, error?: string}>}
   */
  async getAnimatedArtwork(appleMusicUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.artworkTimeout);

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

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Animated artwork API error response:', errorText);
        return { success: false, error: `Animated artwork API returned status: ${response.status}` };
      }

      const data = await response.json();

      if (data.animatedUrl1080 || data.animatedUrl) {
        return { success: true, url: data.animatedUrl1080 || data.animatedUrl };
      }

      return { success: false, error: 'No animated artwork available' };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Animated artwork fetch timeout' };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * ค้นหาและดึง animated artwork URL
   * รวม searchAppleMusicUrl และ getAnimatedArtwork เป็นขั้นตอนเดียว
   * @param {string} songTitle - ชื่อเพลง
   * @param {string} artist - ชื่อศิลปิน  
   * @param {string} album - ชื่ออัลบั้ม (optional)
   * @returns {Promise<{success: boolean, animationUrl?: string, appleMusicUrl?: string, error?: string}>}
   */
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

      console.log(`🍎 Found Apple Music URL for "${artist} - ${songTitle}": ${searchResult.url}`);

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
