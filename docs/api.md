# Music Webhook API Documentation

Base URL: `http://localhost:3000` (default)

## Root & Info

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Welcome message with endpoint listing and features overview. |
| `GET` | `/api` | Dynamic JSON listing of all available API endpoints. |
| `GET` | `/health` | Health check (alias of `/api/health`). |
| `GET` | `/api/health` | Health check (database connectivity, version, uptime). |

## Scrobble & Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhook/scrobble` | Receives scrobble data (compatible with Web Scrobbler, ListenBrainz). Supports event types: `scrobble`, `nowplaying`, `paused`, `stopped`. |
| `POST` | `/webhook` | Alias for scrobble endpoint. |
| `GET` | `/import/listenbrainz` | Renders the structured ListenBrainz import UI. |
| `POST` | `/api/import/listenbrainz` | Bulk import ListenBrainz history (JSON/JSONL, array, or raw text). |

## Analytics & Data

| Method | Endpoint | Parameters | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/stats` | `range` (week, month, year, all-time), `offset`, `recentLimit`, `topArtistLimit`, `tz` | Get overview stats, recent tracks, and top artists. |
| `GET` | `/api/tracks` | `page`, `limit`, `offset`, `sortBy`, `order`, `search`, `searchTitle`, `searchArtist`, `searchAlbum`, `connector`, `source`, `range`, `rangeOffset` | Get paginated track history with field-specific search and filters. |
| `PATCH` | `/api/tracks` | Body: `{ id, isLoved }` | Toggle 'loved' status for a scrobble. |
| `GET` | `/api/tracks/top-artists` | `range`, `offset`, `limit` | Get top artists leaderboard. |
| `GET` | `/api/tracks/top-tracks` | `range`, `offset`, `limit` | Get top tracks leaderboard. |
| `GET` | `/api/track` | `artist`, `title`, `recentLimit`, `tz` | Get specific track analytics. |
| `GET` | `/api/albums` | `artist`, `album`, `recentLimit`, `tz` | Get specific album analytics. |
| `GET` | `/api/artists/:name` | `limit`, `recentLimit`, `tz` | Get artist profile and stats. |

## Player (Now Playing)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/nowplaying` | Get current playing track status. Supports ETag/304 for efficient polling. |
| `POST` | `/api/nowplaying/playing` | Manually set/update now playing status. Body: `{ state: "playing"\|"paused"\|"stopped", track: { title, artist, ... } }`. |

## Spotify Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/spotify/status` | Check if Spotify integration is configured. |
| `GET` | `/api/spotify/stats` | Get enrichment statistics (match rate, enrichment rate, cache stats). |
| `POST` | `/api/spotify/enrich` | Manually trigger enrichment for tracks. Params: `limit` (max 50), `force` (re-enrich all). |
| `POST` | `/api/spotify/update-missing` | Update missing Spotify data. Params: `limit` (max 100), `missingOnly`, `force`, `priority` (comma-separated fields). |
| `DELETE` | `/api/spotify/cache` | Clear Spotify search cache. |

## System & Maintenance

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/duplicates` | Get duplicate scrobble statistics. |
| `DELETE` | `/api/duplicates` | Remove duplicate scrobbles. Params: `dryRun` (preview), `details` (return group info). |
| `DELETE` | `/api/tracks/range` | Delete scrobbles within a date range. Params: `start`, `end` (ISO 8601), `source`, `connector`, `dryRun`. |

## Migration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/migrate` | Render the migration UI page (old tracks → normalized schema). |
| `GET` | `/inspect` | Render the track inspection UI page. |
| `GET` | `/api/migrate/precheck` | Count documents in old and new collections before migration. |
| `POST` | `/api/migrate/run` | Run migration with streaming NDJSON progress. Body: `{ dryRun: boolean }`. |
