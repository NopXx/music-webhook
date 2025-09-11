/**
 * Last.fm API Service
 * ดึงข้อมูลเพิ่มเติมของ track จาก Last.fm API
 */
export class LastFmService {
  constructor() {
    this.apiKey = process.env.LASTFM_API_KEY;
    this.baseUrl = 'https://ws.audioscrobbler.com/2.0/';
    
    if (!this.apiKey) {
      console.warn('⚠️ LASTFM_API_KEY not found in environment variables. Last.fm enrichment will be disabled.');
    }
  }

  /**
   * ดึงข้อมูลเพิ่มเติมของ track จาก Last.fm
   * @param {string} artist - ชื่อศิลปิน
   * @param {string} track - ชื่อเพลง
   * @param {string} album - ชื่ออัลบั้ม (optional)
   * @returns {Promise<Object|null>} ข้อมูลเพิ่มเติมของ track หรือ null ถ้าไม่พบ
   */
  async getTrackInfo(artist, track, album = null) {
    if (!this.apiKey) {
      console.log('🔕 Last.fm API key not configured, skipping track enrichment');
      return null;
    }

    try {
      const params = new URLSearchParams({
        method: 'track.getInfo',
        api_key: this.apiKey,
        artist: artist,
        track: track,
        format: 'json'
      });

      if (album) {
        params.append('album', album);
      }

      console.log(`🔍 Fetching track info from Last.fm: ${artist} - ${track}`);
      
      const response = await fetch(`${this.baseUrl}?${params}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'MusicWebhookServer/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Last.fm API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        console.warn(`⚠️ Last.fm API error: ${data.message}`);
        return null;
      }

      if (!data.track) {
        console.log(`📭 Track not found in Last.fm: ${artist} - ${track}`);
        return null;
      }

      console.log(`✅ Found track info in Last.fm: ${artist} - ${track}`);
      return this.processTrackData(data.track);

    } catch (error) {
      console.error(`❌ Error fetching track info from Last.fm:`, error.message);
      return null;
    }
  }

  /**
   * ดึงข้อมูลศิลปินจาก Last.fm
   * @param {string} artist - ชื่อศิลปิน
   * @returns {Promise<Object|null>} ข้อมูลศิลปิน หรือ null ถ้าไม่พบ
   */
  async getArtistInfo(artist) {
    if (!this.apiKey) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        method: 'artist.getInfo',
        api_key: this.apiKey,
        artist: artist,
        format: 'json'
      });

      console.log(`🔍 Fetching artist info from Last.fm: ${artist}`);
      
      const response = await fetch(`${this.baseUrl}?${params}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'MusicWebhookServer/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Last.fm API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error || !data.artist) {
        return null;
      }

      console.log(`✅ Found artist info in Last.fm: ${artist}`);
      return this.processArtistData(data.artist);

    } catch (error) {
      console.error(`❌ Error fetching artist info from Last.fm:`, error.message);
      return null;
    }
  }

  /**
   * ดึงข้อมูลอัลบั้มจาก Last.fm
   * @param {string} artist - ชื่อศิลปิน
   * @param {string} album - ชื่ออัลบั้ม
   * @returns {Promise<Object|null>} ข้อมูลอัลบั้ม หรือ null ถ้าไม่พบ
   */
  async getAlbumInfo(artist, album) {
    if (!this.apiKey || !album) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        method: 'album.getInfo',
        api_key: this.apiKey,
        artist: artist,
        album: album,
        format: 'json'
      });

      console.log(`🔍 Fetching album info from Last.fm: ${artist} - ${album}`);
      
      const response = await fetch(`${this.baseUrl}?${params}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'MusicWebhookServer/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Last.fm API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error || !data.album) {
        return null;
      }

      console.log(`✅ Found album info in Last.fm: ${artist} - ${album}`);
      return this.processAlbumData(data.album);

    } catch (error) {
      console.error(`❌ Error fetching album info from Last.fm:`, error.message);
      return null;
    }
  }

  /**
   * ประมวลผลข้อมูล track จาก Last.fm API
   */
  processTrackData(trackData) {
    const images = trackData.album?.image || trackData.image || [];
    const largeImage = images.find(img => img.size === 'large') || images.find(img => img.size === 'extralarge') || images[images.length - 1];

    return {
      // ข้อมูลพื้นฐาน
      name: trackData.name,
      artist: trackData.artist?.name || trackData.artist,
      album: trackData.album?.title || trackData.album,
      
      // MBID (MusicBrainz ID)
      mbid: trackData.mbid,
      artistMbid: trackData.artist?.mbid,
      albumMbid: trackData.album?.mbid,
      
      // URLs
      url: trackData.url,
      artistUrl: trackData.artist?.url,
      albumUrl: trackData.album?.url,
      
      // รูปภาพ
      trackArtUrl: largeImage?.['#text'] || null,
      
      // สถิติ
      playcount: parseInt(trackData.playcount) || 0,
      listeners: parseInt(trackData.listeners) || 0,
      userplaycount: parseInt(trackData.userplaycount) || 0,
      userloved: trackData.userloved === '1',
      
      // เวลา
      duration: parseInt(trackData.duration) || null,
      
      // แท็ก
      tags: trackData.toptags?.tag?.map(tag => tag.name) || [],
      
      // ส