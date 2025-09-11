import axios from 'axios';

class SpotifyService {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiresAt = null;
    
    // Spotify API base URL
    this.baseURL = 'https://api.spotify.com/v1';
    
    // Cache untuk search results (ลดการเรียก API ซ้ำ)
    this.searchCache = new Map();
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
  }

  // ตรวจสอบว่า credentials ครบหรือไม่
  isConfigured() {
    return !!(this.clientId && this.clientSecret);
  }

  // ขอ access token จาก Spotify
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    if (!this.isConfigured()) {
      console.warn('⚠️ Spotify API credentials not configured');
      return null;
    }

    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      
      const response = await axios.post('https://accounts.spotify.com/api/token', 
        'grant_type=client_credentials', 
        {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000) - 60000; // ลด 1 นาทีเผื่อความปลอดภัย
      
      console.log('🔑 Spotify access token refreshed');
      return this.accessToken;
      
    } catch (error) {
      console.error('❌ Failed to get Spotify access token:', error.response?.data || error.message);
      return null;
    }
  }

  // สร้าง cache key สำหรับ search
  createCacheKey(artist, title) {
    return `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
  }

  // ค้นหา track จาก Spotify API
  async searchTrack(artist, title) {
    const cacheKey = this.createCacheKey(artist, title);
    
    // ตรวจสอบ cache ก่อน
    if (this.searchCache.has(cacheKey)) {
      const cached = this.searchCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log(`🗄️ Spotify cache hit: ${artist} - ${title}`);
        return cached.data;
      } else {
        this.searchCache.delete(cacheKey);
      }
    }

    const token = await this.getAccessToken();
    if (!token) {
      console.warn('⚠️ Cannot search Spotify: no access token');
      return null;
    }

    try {
      // สร้าง search query
      const query = this.buildSearchQuery(artist, title);
      
      console.log(`🔍 Spotify search query: "${query}"`);
      
      const response = await axios.get(`${this.baseURL}/search`, {
        params: {
          q: query,
          type: 'track',
          limit: 10, // เอาหลายผลลัพธ์มาเพื่อหา match ที่ดีที่สุด
          market: 'US' // ใช้ market US เพื่อให้ได้ผลลัพธ์มากที่สุด
        },
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000 // 10 second timeout
      });

      const tracks = response.data.tracks.items;
      
      if (tracks.length === 0) {
        console.log(`🔍 No Spotify results for: ${artist} - ${title}`);
        // Cache null result เพื่อไม่ให้ค้นหาซ้ำ
        this.searchCache.set(cacheKey, {
          data: null,
          timestamp: Date.now()
        });
        return null;
      }

      console.log(`🔍 Found ${tracks.length} Spotify results for: ${artist} - ${title}`);
      
      // หา match ที่ดีที่สุด
      const bestMatch = this.findBestMatch(tracks, artist, title);
      
      if (bestMatch) {
        const confidence = this.calculateMatchScore(bestMatch, artist, title);
        console.log(`🎵 Best Spotify match: ${bestMatch.artists[0].name} - ${bestMatch.name}`);
        console.log(`   Album: ${bestMatch.album.name}`);
        console.log(`   Confidence: ${Math.round(confidence * 100)}%`);
        
        // แปลงข้อมูลให้อยู่ในรูปแบบที่เราต้องการ
        const enrichedData = this.enrichTrackData(bestMatch);
        enrichedData.match_confidence = confidence;
        
        // Cache ผลลัพธ์
        this.searchCache.set(cacheKey, {
          data: enrichedData,
          timestamp: Date.now()
        });
        
        return enrichedData;
      } else {
        console.log(`🎵 No good Spotify match for: ${artist} - ${title} (confidence too low)`);
        this.searchCache.set(cacheKey, {
          data: null,
          timestamp: Date.now()
        });
        return null;
      }

    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.error(`❌ Spotify search timeout for "${artist} - ${title}"`);
      } else if (error.response?.status === 429) {
        console.error(`❌ Spotify rate limit exceeded for "${artist} - ${title}"`);
        // Don't cache rate limit errors
        return null;
      } else if (error.response?.status >= 500) {
        console.error(`❌ Spotify server error (${error.response.status}) for "${artist} - ${title}"`);
        // Don't cache server errors
        return null;
      } else {
        console.error(`❌ Spotify search error for "${artist} - ${title}":`, error.response?.data?.error?.message || error.message);
      }
      
      // Cache null result สำหรับ client errors เท่านั้น
      if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
        this.searchCache.set(cacheKey, {
          data: null,
          timestamp: Date.now()
        });
      }
      
      return null;
    }
  }

  // สร้าง search query ที่ดี
  buildSearchQuery(artist, title) {
    // ทำความสะอาด text
    const cleanArtist = this.cleanSearchText(artist);
    const cleanTitle = this.cleanSearchText(title);
    
    // สร้าง query แบบต่างๆ เพื่อเพิ่มโอกาสเจอ
    return `track:"${cleanTitle}" artist:"${cleanArtist}"`;
  }

  // ทำความสะอาด text สำหรับการค้นหา
  cleanSearchText(text) {
    return text
      .replace(/\s*\([^)]*\)/g, '') // ลบ (feat. xxx), (remix), etc.
      .replace(/\s*\[[^\]]*\]/g, '') // ลบ [feat. xxx], [remix], etc.
      .replace(/\s*-\s*remix$/i, '') // ลบ - remix ท้ายประโยค
      .replace(/\s*feat\.?\s+.*/i, '') // ลบ feat. xxx
      .replace(/[^\w\s]/g, ' ') // แปลง special characters เป็น space
      .replace(/\s+/g, ' ') // ลด multiple spaces เป็น single space
      .trim();
  }

  // หา match ที่ดีที่สุดจากผลลัพธ์
  findBestMatch(tracks, originalArtist, originalTitle) {
    let bestMatch = null;
    let bestScore = 0;

    for (const track of tracks) {
      const score = this.calculateMatchScore(track, originalArtist, originalTitle);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = track;
      }
    }

    // ต้องมี score อย่างน้อย 0.7 จึงจะถือว่า match
    return bestScore >= 0.7 ? bestMatch : null;
  }

  // คำนวณ score สำหรับ matching
  calculateMatchScore(track, originalArtist, originalTitle) {
    const spotifyArtist = track.artists[0].name.toLowerCase();
    const spotifyTitle = track.name.toLowerCase();
    const origArtist = originalArtist.toLowerCase();
    const origTitle = originalTitle.toLowerCase();

    // คำนวณ similarity สำหรับ artist และ title
    const artistScore = this.calculateSimilarity(origArtist, spotifyArtist);
    const titleScore = this.calculateSimilarity(origTitle, spotifyTitle);

    // คำนวณ score รวม (ให้น้ำหนัก title มากกว่า artist เล็กน้อย)
    return (titleScore * 0.6) + (artistScore * 0.4);
  }

  // คำนวณ similarity ระหว่าง 2 string (แบบง่าย)
  calculateSimilarity(str1, str2) {
    // ทำความสะอาด strings
    const clean1 = this.cleanSearchText(str1);
    const clean2 = this.cleanSearchText(str2);

    // Exact match
    if (clean1 === clean2) return 1.0;

    // Contains check
    if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.9;

    // Levenshtein distance (แบบง่าย)
    const distance = this.levenshteinDistance(clean1, clean2);
    const maxLength = Math.max(clean1.length, clean2.length);
    
    if (maxLength === 0) return 1.0;
    
    return 1 - (distance / maxLength);
  }

  // คำนวณ Levenshtein distance
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  // แปลงข้อมูลจาก Spotify เป็นรูปแบบที่เราต้องการ
  enrichTrackData(spotifyTrack) {
    const mainArtist = spotifyTrack.artists[0];
    const album = spotifyTrack.album;
    
    // สร้าง array ของ artists ทั้งหมด
    const allArtists = spotifyTrack.artists.map(artist => ({
      id: artist.id,
      name: artist.name,
      uri: artist.uri,
      external_urls: artist.external_urls
    }));

    return {
      // ข้อมูลพื้นฐาน
      spotify_id: spotifyTrack.id,
      spotify_uri: spotifyTrack.uri,
      spotify_url: spotifyTrack.external_urls?.spotify,
      
      // ข้อมูล track
      name: spotifyTrack.name,
      duration_ms: spotifyTrack.duration_ms,
      duration_seconds: Math.round(spotifyTrack.duration_ms / 1000),
      explicit: spotifyTrack.explicit,
      popularity: spotifyTrack.popularity,
      preview_url: spotifyTrack.preview_url,
      track_number: spotifyTrack.track_number,
      disc_number: spotifyTrack.disc_number,
      
      // ข้อมูล artist
      artist: {
        id: mainArtist.id,
        name: mainArtist.name,
        uri: mainArtist.uri,
        url: mainArtist.external_urls?.spotify
      },
      all_artists: allArtists,
      
      // ข้อมูล album
      album: {
        id: album.id,
        name: album.name,
        uri: album.uri,
        url: album.external_urls?.spotify,
        release_date: album.release_date,
        release_date_precision: album.release_date_precision,
        total_tracks: album.total_tracks,
        album_type: album.album_type,
        images: album.images || []
      },
      
      // ข้อมูลเพิ่มเติม
      available_markets: spotifyTrack.available_markets?.length || 0,
      is_local: spotifyTrack.is_local || false,
      
      // ข้อมูลสำหรับ debugging
      search_result_rank: 1, // จะถูกแก้ไขถ้าต้องการ
      match_confidence: 1.0, // จะถูกคำนวณจาก matching algorithm
      
      // timestamp
      fetched_at: new Date().toISOString()
    };
  }

  // ดึงข้อมูล audio features (optional - สำหรับข้อมูลเพิ่มเติม)
  async getAudioFeatures(spotifyId) {
    const token = await this.getAccessToken();
    if (!token || !spotifyId) return null;

    try {
      const response = await axios.get(`${this.baseURL}/audio-features/${spotifyId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      return {
        danceability: response.data.danceability,
        energy: response.data.energy,
        key: response.data.key,
        loudness: response.data.loudness,
        mode: response.data.mode,
        speechiness: response.data.speechiness,
        acousticness: response.data.acousticness,
        instrumentalness: response.data.instrumentalness,
        liveness: response.data.liveness,
        valence: response.data.valence,
        tempo: response.data.tempo,
        time_signature: response.data.time_signature
      };
    } catch (error) {
      console.error(`❌ Failed to get audio features for ${spotifyId}:`, error.response?.data || error.message);
      return null;
    }
  }

  // ล้าง cache
  clearCache() {
    this.searchCache.clear();
    console.log('🗑️ Spotify cache cleared');
  }

  // ดู cache statistics
  getCacheStats() {
    const size = this.searchCache.size;
    const keys = Array.from(this.searchCache.keys());
    
    return {
      size,
      cacheTimeout: this.cacheTimeout,
      sampleKeys: keys.slice(0, 5),
      isConfigured: this.isConfigured(),
      hasValidToken: !!(this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt)
    };
  }
}

// Export singleton instance
export default new SpotifyService();
