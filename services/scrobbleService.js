import { normalizeListenBrainzEntry } from '../middleware/validation.js';
import Track from '../models/Track.js';
import spotifyService from './spotifyService.js';
import appleMusicService from './appleMusicService.js';

class ScrobbleService {
  /**
   * Normalize and prepare string for comparison
   */
  baseNormalize(value) {
    return (value ?? '').toString().toLowerCase().trim();
  }

  /**
   * Build track data from validated request body
   */
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

  /**
   * Parse scrobble data from various formats
   */
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

    // Fallback to legacy parsing
    return this.legacyParseScrobbleData(body, req, userAgent, ipAddress);
  }

  /**
   * Legacy parsing method for backward compatibility
   */
  legacyParseScrobbleData(body, req, userAgent, ipAddress) {
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

    if (body.eventName && body.data && body.data.song) {
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

    if (!trackData.title || !trackData.artist) {
      throw new Error('Missing required fields: title and artist');
    }

    return trackData;
  }

  /**
   * Enrich track with Spotify data
   */
  async enrichWithSpotifyData(track) {
    try {
      if (!spotifyService.isConfigured()) return;
      
      console.log(`🎵 Searching Spotify for: ${track.artist} - ${track.title}`);
      
      const spotifyData = await spotifyService.searchTrack(track.artist, track.title);
      
      if (spotifyData) {
        const originalData = {
          duration: track.duration,
          album: track.album,
          year: track.year,
          trackNumber: track.trackNumber
        };
        
        console.log(`✨ Found Spotify match for: ${track.artist} - ${track.title}`);
        
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
        
        const enrichedFields = [];
        
        if (spotifyData.duration_seconds && (!originalData.duration || originalData.duration === null)) {
          updateData.duration = spotifyData.duration_seconds;
          enrichedFields.push('duration');
        }
        
        if (spotifyData.album?.name && (!originalData.album || originalData.album.trim() === '')) {
          updateData.album = spotifyData.album.name;
          enrichedFields.push('album');
        }
        
        if (spotifyData.album?.release_date && (!originalData.year || originalData.year === null)) {
          const releaseYear = new Date(spotifyData.album.release_date).getFullYear();
          if (!isNaN(releaseYear)) {
            updateData.year = releaseYear;
            enrichedFields.push('year');
          }
        }
        
        if (spotifyData.track_number && (!originalData.trackNumber || originalData.trackNumber === null)) {
          updateData.trackNumber = spotifyData.track_number;
          enrichedFields.push('trackNumber');
        }
        
        if (process.env.SPOTIFY_FETCH_AUDIO_FEATURES === 'true') {
          const audioFeatures = await spotifyService.getAudioFeatures(spotifyData.spotify_id);
          if (audioFeatures) {
            updateData['spotify.audio_features'] = audioFeatures;
          }
        }
        
        await Track.findByIdAndUpdate(
          track._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );
        
        console.log(`✅ Spotify enrichment completed for: ${track.artist} - ${track.title}`);
      } else {
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
        if (saveError.message.includes('Cast to ObjectId failed')) {
          console.log(`⚠️ Track ${track._id} no longer exists`);
        } else {
          console.error(`❌ Error saving search attempt status:`, saveError.message);
        }
      }
    }
  }

  /**
   * Enrich track with animated artwork from Apple Music
   */
  async enrichWithAnimationData(track) {
    try {
      console.log(`🎬 Searching animated artwork for: ${track.artist} - ${track.title}`);
      
      const result = await appleMusicService.fetchAnimatedArtwork(
        track.title,
        track.artist,
        track.album || ''
      );
      
      if (result.success && result.animationUrl) {
        console.log(`✨ Found animated artwork for: ${track.artist} - ${track.title}`);
        
        const updateData = {
          animationUrl: result.animationUrl,
          animation_search_attempted: true,
          animation_match_found: true
        };
        
        if (result.appleMusicUrl) {
          updateData.appleMusicUrl = result.appleMusicUrl;
        }
        
        await Track.findByIdAndUpdate(
          track._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );
        
        console.log(`✅ Animation enrichment completed for: ${track.artist} - ${track.title}`);
      } else {
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
      }
      
    } catch (error) {
      console.error(`❌ Error enriching track ${track._id} with animation:`, error.message);
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
}

export default new ScrobbleService();
