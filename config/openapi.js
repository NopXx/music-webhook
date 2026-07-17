// OpenAPI 3.0.3 specification for the Music Webhook API.
// Exported as a plain object so it can be served as JSON at /openapi.json and
// bundled into the Vercel serverless function via import tracing (no file reads).

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', example: 'Validation failed' },
    message: { type: 'string', example: 'Missing required fields: title and artist' },
  },
};

const rangeParam = {
  name: 'range',
  in: 'query',
  description: 'Time window for aggregation.',
  schema: {
    type: 'string',
    enum: ['day', 'week', 'month', 'year', 'all-time'],
  },
};

const offsetParam = {
  name: 'offset',
  in: 'query',
  description: 'Shift the time window backwards by N windows (e.g. offset=1 with range=week is the previous week).',
  schema: { type: 'integer', default: 0 },
};

const tzParam = {
  name: 'tz',
  in: 'query',
  description: 'IANA timezone used for day/hour bucketing (e.g. Asia/Bangkok).',
  schema: { type: 'string' },
};

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Music Webhook API',
    version: '1.0.2',
    description:
      'Webhook server that ingests music scrobbles (Web Scrobbler, ListenBrainz, native clients) into a ' +
      'normalized MongoDB schema (Artist → Album → TrackMeta → Scrobble) and enriches tracks with Spotify, ' +
      'Apple Music animated artwork, and Last.fm metadata.\n\n' +
      '**Auth (two layers):**\n' +
      '- **JWT (BearerAuth)** — register/login at `/api/auth/*`, then send `Authorization: Bearer <token>` ' +
      '(also accepted via the `token` cookie). Analytics reads are scoped to the authenticated user; ' +
      'admin role is required for writes/maintenance.\n' +
      '- **API key (ApiKeyAuth)** — for scrobbler clients on `/webhook/*` and now-playing intake; ' +
      'send it via the `x-api-key` header. Keys are created at `POST /api/auth/api-keys` and bound to a user, ' +
      'so scrobbles are owned automatically.\n' +
      '- **API key via query (ApiKeyQueryAuth)** — for clients that can only configure a URL and cannot set ' +
      'headers (e.g. Web Scrobbler\'s webhook): append `?api_key=<key>` to the endpoint URL. ' +
      'Note the key will appear in server/proxy access logs — prefer the header when the client supports it.\n\n' +
      'Data is per-user: each user only sees and manages their own scrobbles and now-playing state.',
  },
  servers: [
    { url: '/', description: 'Current host' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'Info', description: 'Root and discovery endpoints' },
    { name: 'Auth', description: 'Registration, login, and API key management' },
    { name: 'Scrobble', description: 'Scrobble intake and bulk import' },
    { name: 'Now Playing', description: 'In-memory now-playing state' },
    { name: 'Analytics', description: 'Stats, leaderboards, track/album/artist insights' },
    { name: 'Spotify', description: 'Spotify enrichment management' },
    { name: 'System', description: 'Health, duplicates, maintenance' },
    { name: 'Migration', description: 'Legacy → normalized schema migration' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      ApiKeyQueryAuth: { type: 'apiKey', in: 'query', name: 'api_key' },
    },
    schemas: {
      Error: errorSchema,
      ScrobblePayload: {
        type: 'object',
        description:
          'The webhook accepts several payload shapes; the server auto-detects the format. ' +
          'At minimum a title and artist must be resolvable. Shown here is the simple format.',
        required: ['title', 'artist'],
        properties: {
          title: { type: 'string', maxLength: 500, example: 'Supernova Love' },
          artist: { type: 'string', maxLength: 200, example: 'IVE & David Guetta' },
          album: { type: 'string', maxLength: 300, example: 'Supernova Love' },
          duration: { type: 'number', description: 'Seconds.', example: 215 },
          connector: { type: 'string', example: 'spotify' },
          source: { type: 'string', example: 'web-scrobbler' },
          eventName: {
            type: 'string',
            description: 'Event type. Non-scrobble events update now-playing state without creating a scrobble.',
            enum: ['scrobble', 'nowplaying', 'paused', 'stopped'],
          },
          time: { type: 'string', description: 'Timestamp (ISO or epoch).' },
          url: { type: 'string' },
          metadata: {
            type: 'object',
            description: 'Optional extra fields merged into TrackMeta.',
            properties: {
              trackArtUrl: { type: 'string' },
              artistUrl: { type: 'string' },
              trackUrl: { type: 'string' },
              albumUrl: { type: 'string' },
              label: { type: 'string' },
              animationUrl: { type: 'string' },
              masterTallUrl: { type: 'string' },
              primaryMediaUrl: { type: 'string' },
              primaryMediaType: { type: 'string' },
              userPlayCount: { type: 'number' },
              userloved: { type: 'boolean' },
            },
          },
        },
      },
      ListenBrainzEntry: {
        type: 'object',
        required: ['track_metadata'],
        properties: {
          listened_at: { type: 'number', example: 1733035913 },
          inserted_at: { type: 'number', example: 1759922716.66 },
          track_metadata: {
            type: 'object',
            properties: {
              track_name: { type: 'string', example: 'Supernova Love' },
              artist_name: { type: 'string', example: 'IVE & David Guetta' },
              release_name: { type: 'string', example: 'Supernova Love' },
              mbid_mapping: {
                type: 'object',
                properties: {
                  recording_mbid: { type: 'string' },
                  release_mbid: { type: 'string' },
                },
              },
              additional_info: {
                type: 'object',
                properties: {
                  duration_ms: { type: 'number' },
                  listen_url: { type: 'string' },
                },
              },
            },
          },
        },
      },
      NowPlayingStatus: {
        type: 'object',
        properties: {
          playing: { type: 'boolean' },
          status: { type: 'string', enum: ['playing', 'paused', 'stopped'] },
          updatedAt: { type: 'string', format: 'date-time' },
          track: {
            type: 'object',
            nullable: true,
            properties: {
              title: { type: 'string' },
              artist: { type: 'string' },
              album: { type: 'string' },
              animationUrl: { type: 'string', nullable: true },
              appleMusicUrl: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  },
  // Default: JWT required. Public endpoints override with `security: []`;
  // scrobbler intake overrides with ApiKeyAuth/BearerAuth.
  security: [{ BearerAuth: [] }],
  paths: {
    '/': {
      get: {
        tags: ['Info'],
        summary: 'Welcome message and endpoint overview',
        security: [],
        responses: { 200: { description: 'Welcome JSON' } },
      },
    },
    '/api': {
      get: {
        tags: ['Info'],
        summary: 'Dynamic JSON listing of all endpoints',
        security: [],
        responses: { 200: { description: 'Endpoint listing' } },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check (alias of /api/health)',
        security: [],
        responses: {
          200: { description: 'Healthy' },
          503: { description: 'Database disconnected' },
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Verifies MongoDB connectivity and reports version/uptime.',
        security: [],
        responses: {
          200: {
            description: 'Healthy',
            content: {
              'application/json': {
                example: {
                  status: 'healthy',
                  timestamp: '2026-06-05T10:00:00.000Z',
                  database: 'connected',
                  version: '1.0.2',
                  uptime: 1234.5,
                },
              },
            },
          },
          503: { description: 'Database disconnected' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user (role: viewer)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created — returns JWT + sets token cookie' },
          400: { description: 'Invalid email/password' },
          409: { description: 'Email already registered' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and receive a JWT',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'JWT + token cookie' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/logout': {
      post: { tags: ['Auth'], summary: 'Clear the auth cookie', security: [], responses: { 200: { description: 'Logged out' } } },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Current authenticated user', responses: { 200: { description: 'User' }, 401: { description: 'Unauthorized' } } },
    },
    '/api/auth/api-keys': {
      get: {
        tags: ['Auth'],
        summary: 'List your API keys (non-revoked)',
        responses: { 200: { description: 'API keys (prefix + label, no raw key)' }, 401: { description: 'Unauthorized' } },
      },
      post: {
        tags: ['Auth'],
        summary: 'Create an API key (shown once)',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { label: { type: 'string' } } },
            },
          },
        },
        responses: {
          201: { description: 'Created — `key` (raw) returned once' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/api-keys/{id}': {
      delete: {
        tags: ['Auth'],
        summary: 'Revoke an API key',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Revoked' }, 404: { description: 'Not found' } },
      },
    },
    '/webhook/scrobble': {
      post: {
        tags: ['Scrobble'],
        summary: 'Submit a scrobble / now-playing event',
        security: [{ ApiKeyAuth: [] }, { ApiKeyQueryAuth: [] }, { BearerAuth: [] }],
        description:
          'Accepts Web Scrobbler (old & new), ListenBrainz import, and simple JSON payloads. ' +
          '`scrobble` events are persisted; `nowplaying`/`paused`/`stopped` events only update in-memory state. ' +
          'Spotify and Apple Music enrichment run in the background after a successful write. ' +
          'Rate limited to 100 requests/minute.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScrobblePayload' },
            },
          },
        },
        responses: {
          200: {
            description: 'Processed. `action` is one of created/updated/skipped/ignored.',
            content: {
              'application/json': {
                example: {
                  success: true,
                  action: 'created',
                  message: 'Scrobble received successfully',
                },
              },
            },
          },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          500: { description: 'Server error' },
        },
      },
    },
    '/webhook': {
      post: {
        tags: ['Scrobble'],
        summary: 'Alias for /webhook/scrobble',
        security: [{ ApiKeyAuth: [] }, { ApiKeyQueryAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrobblePayload' } } },
        },
        responses: { 200: { description: 'Processed' }, 400: { description: 'Validation failed' } },
      },
    },
    '/api/import/listenbrainz': {
      post: {
        tags: ['Scrobble'],
        summary: 'Bulk import ListenBrainz history',
        description:
          'Accepts an array of entries, `{ entries: [...] }`, a single entry with `track_metadata`, ' +
          'or `{ raw: "<json or json-lines string>" }`. Each entry runs through the normal scrobble pipeline ' +
          'and queues Spotify enrichment when configured.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { type: 'array', items: { $ref: '#/components/schemas/ListenBrainzEntry' } },
                  {
                    type: 'object',
                    properties: {
                      entries: { type: 'array', items: { $ref: '#/components/schemas/ListenBrainzEntry' } },
                      raw: { type: 'string' },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          200: { description: 'All entries imported' },
          207: { description: 'Partial success (some entries errored)' },
          400: { description: 'Nothing importable' },
        },
      },
    },
    '/import/listenbrainz': {
      get: {
        tags: ['Scrobble'],
        summary: 'ListenBrainz import UI (HTML)',
        responses: { 200: { description: 'HTML page' } },
      },
    },
    '/api/tracks': {
      get: {
        tags: ['Analytics'],
        summary: 'List tracks with pagination, search and filters',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', example: 'scrobbledAt' } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          { name: 'search', in: 'query', description: 'Free-text search across title/artist/album.', schema: { type: 'string' } },
          { name: 'searchTitle', in: 'query', schema: { type: 'string' } },
          { name: 'searchArtist', in: 'query', schema: { type: 'string' } },
          { name: 'searchAlbum', in: 'query', schema: { type: 'string' } },
          { name: 'connector', in: 'query', schema: { type: 'string' } },
          { name: 'source', in: 'query', schema: { type: 'string' } },
          rangeParam,
          { name: 'rangeOffset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Paginated listing' } },
      },
      patch: {
        tags: ['Analytics'],
        summary: 'Toggle the loved flag for a track',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'isLoved'],
                properties: {
                  id: { type: 'string', description: 'Scrobble or TrackMeta id.' },
                  isLoved: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated' },
          400: { description: 'Missing id or invalid isLoved' },
          404: { description: 'Track not found' },
        },
      },
    },
    '/api/tracks/range': {
      delete: {
        tags: ['System'],
        summary: 'Delete tracks within a scrobbledAt date range',
        parameters: [
          { name: 'start', in: 'query', required: true, description: 'ISO date.', schema: { type: 'string', example: '2024-01-01T00:00:00Z' } },
          { name: 'end', in: 'query', required: true, description: 'ISO date.', schema: { type: 'string', example: '2024-02-01T00:00:00Z' } },
          { name: 'source', in: 'query', schema: { type: 'string' } },
          { name: 'connector', in: 'query', schema: { type: 'string' } },
          { name: 'dryRun', in: 'query', description: 'Preview without deleting.', schema: { type: 'boolean' } },
        ],
        responses: {
          200: { description: 'Deleted (or previewed when dryRun=true)' },
          400: { description: 'Missing/invalid range' },
        },
      },
    },
    '/api/tracks/top-artists': {
      get: {
        tags: ['Analytics'],
        summary: 'Top artists leaderboard',
        parameters: [rangeParam, offsetParam, { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }],
        responses: { 200: { description: 'Leaderboard' } },
      },
    },
    '/api/tracks/top-tracks': {
      get: {
        tags: ['Analytics'],
        summary: 'Top tracks leaderboard',
        parameters: [rangeParam, offsetParam, { name: 'limit', in: 'query', schema: { type: 'integer', default: 15 } }],
        responses: { 200: { description: 'Leaderboard' } },
      },
    },
    '/api/track': {
      get: {
        tags: ['Analytics'],
        summary: 'Single track analytics',
        parameters: [
          { name: 'artist', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'title', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'recentLimit', in: 'query', schema: { type: 'integer', default: 12 } },
          tzParam,
        ],
        responses: {
          200: { description: 'Track insights' },
          400: { description: 'artist and title required' },
          404: { description: 'No scrobbles found' },
        },
      },
    },
    '/api/albums': {
      get: {
        tags: ['Analytics'],
        summary: 'Album analytics',
        parameters: [
          { name: 'artist', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'album', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'recentLimit', in: 'query', schema: { type: 'integer', default: 12 } },
          tzParam,
        ],
        responses: {
          200: { description: 'Album insights' },
          400: { description: 'artist and album required' },
          404: { description: 'No scrobbles found' },
        },
      },
    },
    '/api/artists/{name}': {
      get: {
        tags: ['Analytics'],
        summary: 'Artist profile and analytics',
        parameters: [
          { name: 'name', in: 'path', required: true, description: 'URL-encoded artist name.', schema: { type: 'string' } },
          { name: 'limit', in: 'query', description: 'Top tracks/albums limit.', schema: { type: 'integer', default: 10 } },
          { name: 'recentLimit', in: 'query', schema: { type: 'integer', default: 15 } },
          tzParam,
        ],
        responses: {
          200: { description: 'Artist profile' },
          404: { description: 'No scrobbles found' },
        },
      },
    },
    '/api/stats': {
      get: {
        tags: ['Analytics'],
        summary: 'Aggregate listening statistics',
        description: 'Totals, connector breakdown, top artists, recent scrobbles, plus Spotify enrichment stats when configured.',
        parameters: [
          rangeParam,
          offsetParam,
          { name: 'recentLimit', in: 'query', description: 'Recent scrobbles to include (1–25).', schema: { type: 'integer', default: 10 } },
          { name: 'topArtistLimit', in: 'query', schema: { type: 'integer', default: 5 } },
        ],
        responses: { 200: { description: 'Stats overview' } },
      },
    },
    '/api/nowplaying': {
      get: {
        tags: ['Now Playing'],
        summary: 'Get current now-playing snapshot',
        description: 'Supports conditional requests via ETag — returns 304 when the `If-None-Match` header matches.',
        parameters: [
          { name: 'If-None-Match', in: 'header', description: 'ETag from a previous response.', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Now-playing status', content: { 'application/json': { schema: { $ref: '#/components/schemas/NowPlayingStatus' } } } },
          304: { description: 'Not modified' },
        },
      },
    },
    '/api/nowplaying/playing': {
      post: {
        tags: ['Now Playing'],
        summary: 'Set now-playing state',
        security: [{ ApiKeyAuth: [] }, { ApiKeyQueryAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['state'],
                properties: {
                  state: { type: 'string', enum: ['playing', 'paused', 'stopped'] },
                  track: {
                    type: 'object',
                    description: 'Required when state is "playing". title and artist are mandatory.',
                    properties: {
                      title: { type: 'string' },
                      artist: { type: 'string' },
                      album: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/NowPlayingStatus' } } } },
          400: { description: 'Invalid state or missing track data' },
        },
      },
    },
    '/api/spotify/status': {
      get: {
        tags: ['Spotify'],
        summary: 'Spotify integration status',
        responses: { 200: { description: 'Configuration and cache status' } },
      },
    },
    '/api/spotify/stats': {
      get: {
        tags: ['Spotify'],
        summary: 'Spotify enrichment statistics',
        responses: { 200: { description: 'Enrichment/match rates and cache stats' } },
      },
    },
    '/api/spotify/enrich': {
      post: {
        tags: ['Spotify'],
        summary: 'Manually enrich tracks with Spotify',
        parameters: [
          { name: 'limit', in: 'query', description: 'Tracks to process (max 50).', schema: { type: 'integer', default: 10 } },
          { name: 'force', in: 'query', description: 'Re-enrich already-attempted tracks.', schema: { type: 'boolean', default: false } },
        ],
        responses: {
          200: { description: 'Enrichment completed' },
          400: { description: 'Spotify not configured' },
        },
      },
    },
    '/api/spotify/update-missing': {
      post: {
        tags: ['Spotify'],
        summary: 'Fill missing metadata via Spotify',
        parameters: [
          { name: 'limit', in: 'query', description: 'Tracks to process (max 100).', schema: { type: 'integer', default: 50 } },
          { name: 'missingOnly', in: 'query', description: 'Only tracks missing priority fields.', schema: { type: 'boolean' } },
          { name: 'force', in: 'query', description: 'Update all tracks.', schema: { type: 'boolean' } },
          { name: 'priority', in: 'query', description: 'Comma-separated fields to target. Unknown fields are ignored.', schema: { type: 'string', default: 'duration,album,trackNumber', enum: ['duration', 'album', 'trackNumber'] } },
        ],
        responses: {
          200: { description: 'Update completed' },
          400: { description: 'Spotify not configured' },
        },
      },
    },
    '/api/spotify/cache': {
      delete: {
        tags: ['Spotify'],
        summary: 'Clear the Spotify search cache',
        responses: { 200: { description: 'Cache cleared' } },
      },
    },
    '/api/duplicates': {
      get: {
        tags: ['System'],
        summary: 'Duplicate scrobble statistics',
        responses: { 200: { description: 'Duplicate groups and totals' } },
      },
      delete: {
        tags: ['System'],
        summary: 'Remove duplicate scrobbles',
        description: 'Groups by track + connector within a 5-minute window, keeping the most recent.',
        parameters: [
          { name: 'dryRun', in: 'query', description: 'Preview without deleting.', schema: { type: 'boolean' } },
          { name: 'details', in: 'query', description: 'Include per-group detail in the response.', schema: { type: 'boolean' } },
        ],
        responses: { 200: { description: 'Removed (or previewed)' } },
      },
    },
    '/api/migrate/precheck': {
      get: {
        tags: ['Migration'],
        summary: 'Count documents in old vs new collections',
        responses: { 200: { description: 'Counts' } },
      },
    },
    '/api/migrate/run': {
      post: {
        tags: ['Migration'],
        summary: 'Run the legacy → normalized migration',
        description: 'Streams progress as newline-delimited JSON (application/x-ndjson). Defaults to a dry run.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  dryRun: { type: 'boolean', default: true, description: 'Set false to write data.' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'NDJSON stream of {type: start|progress|error|done} objects',
            content: { 'application/x-ndjson': {} },
          },
        },
      },
    },
    '/migrate': {
      get: { tags: ['Migration'], summary: 'Migration UI (HTML)', responses: { 200: { description: 'HTML page' } } },
    },
    '/inspect': {
      get: { tags: ['Migration'], summary: 'Track inspection UI (HTML)', responses: { 200: { description: 'HTML page' } } },
    },
  },
};

export default openapi;
