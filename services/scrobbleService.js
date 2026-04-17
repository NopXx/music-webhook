import { normalizeListenBrainzEntry } from '../middleware/validation.js';
import TrackMeta from '../models/TrackMeta.js';
import Album from '../models/Album.js';
import spotifyService from './spotifyService.js';
import appleMusicService from './appleMusicService.js';
import {
  coerceNumber,
  normalizeStartTimestamp,
  mergeMetadata,
} from '../utils/trackNormalizer.js';

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
      startTimestamp: normalizeStartTimestamp(validatedTrack.startTimestamp),
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
   * Enrich a TrackMeta document with Spotify data.
   * Accepts either a TrackMeta doc directly, or a scrobble result with _trackMeta.
   */
  async enrichWithSpotifyData(trackOrScrobble) {
    // Resolve the TrackMeta document
    let trackMeta = trackOrScrobble._trackMeta || trackOrScrobble;
    const artistName = trackMeta.artist?.name || trackOrScrobble.artist || '';
    const trackTitle = trackMeta.title || trackOrScrobble.title || '';

    try {
      if (!spotifyService.isConfigured()) return;

      console.log(`🎵 Searching Spotify for: ${artistName} - ${trackTitle}`);

      const spotifyData = await spotifyService.searchTrack(artistName, trackTitle);

      if (spotifyData) {
        console.log(`✨ Found Spotify match for: ${artistName} - ${trackTitle}`);

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
            fetched_at: new Date(),
          },
          spotify_enriched: true,
          spotify_search_attempted: true,
          spotify_match_found: true,
        };

        // Fill missing basic data
        if (spotifyData.duration_seconds && !trackMeta.duration) {
          updateData.duration = spotifyData.duration_seconds;
        }
        if (spotifyData.track_number && !trackMeta.trackNumber) {
          updateData.trackNumber = spotifyData.track_number;
        }

        if (process.env.SPOTIFY_FETCH_AUDIO_FEATURES === 'true') {
          const audioFeatures = await spotifyService.getAudioFeatures(spotifyData.spotify_id);
          if (audioFeatures) {
            updateData['spotify.audio_features'] = audioFeatures;
          }
        }

        await TrackMeta.findByIdAndUpdate(
          trackMeta._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );

        // Patch Album with year if available
        if (spotifyData.album?.release_date && trackMeta.album) {
          const releaseYear = new Date(spotifyData.album.release_date).getFullYear();
          if (!isNaN(releaseYear)) {
            await Album.findByIdAndUpdate(
              trackMeta.album,
              { $set: { year: releaseYear } },
              { new: true }
            ).catch(() => {});
          }
        }

        // Patch Album name if missing
        if (spotifyData.album?.name && !trackMeta.album) {
          // Try to create the album and link it
          const artistId = trackMeta.artist?._id || trackMeta.artist;
          if (artistId) {
            const albumDoc = await Album.findOrCreateByNameAndArtist(
              spotifyData.album.name, artistId, {
                year: spotifyData.album.release_date
                  ? new Date(spotifyData.album.release_date).getFullYear()
                  : undefined,
              }
            );
            if (albumDoc) {
              await TrackMeta.findByIdAndUpdate(trackMeta._id, { $set: { album: albumDoc._id } });
            }
          }
        }

        console.log(`✅ Spotify enrichment completed for: ${artistName} - ${trackTitle}`);
      } else {
        await TrackMeta.findByIdAndUpdate(
          trackMeta._id,
          {
            $set: {
              spotify_search_attempted: true,
              spotify_match_found: false,
              spotify_enriched: false,
            },
          }
        );
        console.log(`❌ No Spotify match found for: ${artistName} - ${trackTitle}`);
      }
    } catch (error) {
      console.error(`❌ Error enriching TrackMeta ${trackMeta._id} with Spotify:`, error.message);
      try {
        await TrackMeta.findByIdAndUpdate(
          trackMeta._id,
          {
            $set: {
              spotify_search_attempted: true,
              spotify_match_found: false,
              spotify_enriched: false,
            },
          }
        );
      } catch (saveError) {
        if (saveError.message?.includes('Cast to ObjectId failed')) {
          console.log(`⚠️ TrackMeta ${trackMeta._id} no longer exists`);
        } else {
          console.error('❌ Error saving search attempt status:', saveError.message);
        }
      }
    }
  }

  /**
   * Enrich a TrackMeta document with animated artwork from Apple Music.
   * Accepts either a TrackMeta doc directly, or a scrobble result with _trackMeta.
   */
  async enrichWithAnimationData(trackOrScrobble) {
    let trackMeta = trackOrScrobble._trackMeta || trackOrScrobble;
    const artistName = trackMeta.artist?.name || trackOrScrobble.artist || '';
    const trackTitle = trackMeta.title || trackOrScrobble.title || '';
    const albumName = trackMeta.album?.name || trackOrScrobble.album || '';

    try {
      console.log(`🎬 Searching animated artwork for: ${artistName} - ${trackTitle}`);

      const result = await appleMusicService.fetchAnimatedArtwork(
        trackTitle,
        artistName,
        albumName
      );

      if (result.success && result.animationUrl) {
        console.log(`✨ Found animated artwork for: ${artistName} - ${trackTitle}`);

        const updateData = {
          animationUrl: result.animationUrl,
          animation_search_attempted: true,
          animation_match_found: true,
        };

        if (result.appleMusicUrl) {
          updateData.appleMusicUrl = result.appleMusicUrl;
        }

        await TrackMeta.findByIdAndUpdate(
          trackMeta._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );

        console.log(`✅ Animation enrichment completed for: ${artistName} - ${trackTitle}`);
      } else {
        await TrackMeta.findByIdAndUpdate(
          trackMeta._id,
          {
            $set: {
              animation_search_attempted: true,
              animation_match_found: false,
            },
          }
        );
        console.log(`❌ No animated artwork found for: ${artistName} - ${trackTitle}`);
      }
    } catch (error) {
      console.error(`❌ Error enriching TrackMeta ${trackMeta._id} with animation:`, error.message);
      try {
        await TrackMeta.findByIdAndUpdate(
          trackMeta._id,
          {
            $set: {
              animation_search_attempted: true,
              animation_match_found: false,
            },
          }
        );
      } catch (saveError) {
        if (saveError.message?.includes('Cast to ObjectId failed')) {
          console.log(`⚠️ TrackMeta ${trackMeta._id} no longer exists`);
        } else {
          console.error('❌ Error saving animation search attempt status:', saveError.message);
        }
      }
    }
  }
}

export default new ScrobbleService();
