/**
 * Last.fm API Service
 * ดึงข้อมูลเพิ่มเติมจาก Last.fm ทั้ง track / artist / album
 */
export class LastFmService {
  constructor() {
    this.apiKey = process.env.LASTFM_API_KEY;
    this.baseUrl = 'https://ws.audioscrobbler.com/2.0/';
    this.userAgent = 'MusicWebhookServer/1.0';

    if (!this.apiKey) {
      console.warn('⚠️ LASTFM_API_KEY not found. Last.fm helpers will fall back to placeholder images.');
    }
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  buildParams(method, extra = {}) {
    const params = new URLSearchParams({
      method,
      format: 'json',
      api_key: this.apiKey || ''
    });

    Object.entries(extra || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value);
      }
    });

    return params;
  }

  async request(method, params = {}) {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const query = this.buildParams(method, params);
      const response = await fetch(`${this.baseUrl}?${query.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent
        }
      });

      if (!response.ok) {
        throw new Error(`Last.fm API responded with ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        console.warn(`⚠️ Last.fm API error: ${data.message}`);
        return null;
      }

      return data;
    } catch (error) {
      console.error(`❌ Last.fm request failed (${method}):`, error.message);
      return null;
    }
  }

  async getTrackInfo(artist, track, album = null) {
    if (!artist || !track) return null;

    const payload = await this.request('track.getInfo', {
      artist,
      track,
      album
    });

    if (!payload?.track) {
      return null;
    }

    return this.processTrackData(payload.track);
  }

  async getArtistInfo(artist) {
    if (!artist) return null;

    const payload = await this.request('artist.getInfo', {
      artist
    });

    if (!payload?.artist) {
      return null;
    }

    return this.processArtistData(payload.artist);
  }

  async getAlbumInfo(artist, album) {
    if (!artist || !album) return null;

    const payload = await this.request('album.getInfo', {
      artist,
      album
    });

    if (!payload?.album) {
      return null;
    }

    return this.processAlbumData(payload.album);
  }

  pickBestImage(images = []) {
    if (!Array.isArray(images)) {
      return null;
    }

    const prioritized = ['mega', 'extralarge', 'large'];
    for (const size of prioritized) {
      const found = images.find((img) => img?.size === size && img['#text']);
      if (found) {
        return {
          url: found['#text'],
          size: size
        };
      }
    }

    const fallback = images.find((img) => img?.['#text']);
    if (fallback) {
      return {
        url: fallback['#text'],
        size: fallback.size || 'unknown'
      };
    }

    return null;
  }

  processTrackData(trackData) {
    const images = trackData.album?.image || trackData.image || [];
    const bestImage = this.pickBestImage(images);

    return {
      name: trackData.name,
      artist: trackData.artist?.name || trackData.artist,
      album: trackData.album?.title || trackData.album,
      mbid: trackData.mbid || null,
      artistMbid: trackData.artist?.mbid || null,
      albumMbid: trackData.album?.mbid || null,
      url: trackData.url,
      artistUrl: trackData.artist?.url,
      albumUrl: trackData.album?.url,
      trackArtUrl: bestImage?.url || null,
      playcount: parseInt(trackData.playcount, 10) || 0,
      listeners: parseInt(trackData.listeners, 10) || 0,
      userplaycount: parseInt(trackData.userplaycount, 10) || 0,
      userloved: trackData.userloved === '1',
      duration: parseInt(trackData.duration, 10) || null,
      tags: trackData.toptags?.tag?.map((tag) => tag.name) || [],
      wiki: trackData.wiki
        ? {
            summary: trackData.wiki.summary,
            content: trackData.wiki.content
          }
        : null
    };
  }

  processArtistData(artistData) {
    const images = (artistData.image || [])
      .map((img) => ({
        url: img['#text'],
        size: img.size
      }))
      .filter((img) => img.url);

    const heroImage = this.pickBestImage(artistData.image || []);

    return {
      name: artistData.name,
      mbid: artistData.mbid || null,
      url: artistData.url,
      bio: artistData.bio
        ? {
            summary: artistData.bio.summary,
            content: artistData.bio.content
          }
        : null,
      stats: {
        listeners: parseInt(artistData.stats?.listeners, 10) || 0,
        playcount: parseInt(artistData.stats?.playcount, 10) || 0
      },
      tags: artistData.tags?.tag?.map((tag) => tag.name) || [],
      images,
      heroImage: heroImage?.url || null
    };
  }

  processAlbumData(albumData) {
    const images = (albumData.image || [])
      .map((img) => ({
        url: img['#text'],
        size: img.size
      }))
      .filter((img) => img.url);

    const heroImage = this.pickBestImage(albumData.image || []);

    return {
      name: albumData.name || albumData.album,
      artist: albumData.artist,
      mbid: albumData.mbid || null,
      url: albumData.url,
      listeners: parseInt(albumData.listeners, 10) || 0,
      playcount: parseInt(albumData.playcount, 10) || 0,
      tracks: Array.isArray(albumData.tracks?.track)
        ? albumData.tracks.track.map((track) => ({
            name: track.name,
            duration: parseInt(track.duration, 10) || null,
            url: track.url
          }))
        : [],
      wiki: albumData.wiki
        ? {
            summary: albumData.wiki.summary,
            content: albumData.wiki.content
          }
        : null,
      images,
      heroImage: heroImage?.url || null
    };
  }

  async getArtistImageUrl(artist) {
    const info = await this.getArtistInfo(artist);
    return info?.heroImage || null;
  }
}

const lastFmInstance = new LastFmService();

export default lastFmInstance;