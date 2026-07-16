# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Webhook server that ingests music listening data (Web Scrobbler, ListenBrainz, native Apple Music client) and stores it in MongoDB using a **normalized relational-style schema**. Enriches tracks from Spotify, Apple Music (animated artwork), and Last.fm. Express.js running on **Bun**, deployable to Vercel serverless.

## Commands

```bash
bun install              # Install deps (uses bun.lockb, not package-lock)
bun run dev              # Dev server with hot reload (--hot)
bun run start            # Production server
```

Two distinct test styles — know which is which:

- **`*.test.js`** (e.g. `cache.test.js`, `scrobbleService.test.js`) use the `bun:test` framework and connect to MongoDB directly. Run with `bun test test/cache.test.js`. They need a reachable `MONGODB_URI` (default falls back to `mongodb://localhost:27017/music-webhook-test`).
- **`test-*.js` / `quick-test.js`** are integration scripts that HTTP-POST against a **running server** at `http://localhost:3000`. Start the server first, then run e.g. `bun run test:spotify`, `bun run quick-test`. The `bun run test:*` npm scripts map to these.

Run a single bun:test file: `bun test test/<name>.test.js`. There is no aggregate "run all" that covers both styles.

## Architecture

### Normalized data model (the core design)
Data is split across 4 collections instead of one monolithic `tracks` doc. Each scrobble write runs a `findOrCreate` pipeline:

```
Artist ◄── Album ◄── TrackMeta ◄── Scrobble
```

- **Artist** — unique on `nameLower`; `Artist.findOrCreateByName()`
- **Album** — unique on `nameLower` + `artist`; `Album.findOrCreateByNameAndArtist()`
- **TrackMeta** — unique on `titleLower` + `artist`; holds Spotify data, `animationUrl`, duration. `TrackMeta.findOrCreateByIdentity()`
- **Scrobble** — one row per listen (no unique constraint); references TrackMeta. `Scrobble.findOrCreateScrobble()` drives the whole pipeline (steps 1→5: artist, album, trackmeta, dedup check, create).
- **`models/Track.js`** is the **legacy** monolithic schema, kept only for pre-migration compatibility. New code uses the normalized models.

Concurrency: duplicate creation is prevented by MongoDB unique indexes + `findOrCreate` with explicit error-code `11000` handling. When touching the create pipeline, preserve this — race tests live in `test-race-condition.js`.

### Request flow
`index.js` (class `MusicWebhookServer`) wires middleware → routes. `routes/webhook.js` is a thin aggregator mapping endpoint names to controller methods. Controllers are split by domain: `scrobbleController`, `analyticsController`, `playerController` (now-playing), `spotifyController`, `systemController` (health, duplicates, migration). Business logic lives in `services/`, not controllers.

Scrobble path: validation middleware (`middleware/validation.js`) detects payload format (Web Scrobbler old/new, ListenBrainz, legacy) and sets `req.validatedTrack` → `scrobbleService.parseScrobbleData()` normalizes to canonical form → `Scrobble.findOrCreateScrobble()`. Enrichment (Apple Music animated artwork + Spotify metadata) runs **fire-and-forget** after the write, not inline.

`utils/trackNormalizer.js` is the single source of truth for normalization: date parsing, source detection, metadata merge, cover-art derivation, album-name cleaning (strips `-EP`, `(Single)`, `(Deluxe Version)`, etc.). Album-name cleaning affects grouping — change it carefully.

### Caching layer (two-tier, Redis optional)
`services/cacheRepo.js` is the unified cache: reads/writes Redis first, falls back to MongoDB `Cache` model (TTL ~30 days). **Redis is fully optional** — `config/redis.js` only connects if `REDIS_URL` is set, and every Redis call is guarded by `redis?.status === 'ready'` with silent fallback. Never assume Redis is present. A `__NULL__` sentinel distinguishes cached-null from cache-miss.

### Now Playing (multi-source, flicker-resistant)
`services/nowPlayingService.js` keeps per-source state in a `Map` keyed by **`source:connector`** (compound key — see `_sourceKey()`), so concurrent scrobblers don't overwrite each other. One "primary" source is surfaced via sticky selection to avoid flicker. State persists to Redis (`nowplaying:state`, 1-day TTL) and is rehydrated on boot via `hydrate()` (called in `server.start()`). Endpoints support ETag / 304. ListenBrainz backfill older than 5 min does not touch now-playing.

### Serverless vs standalone
`index.js` exports `app` and only calls `.start()` when run directly (`import.meta.url` check). `api/index.js` is the Vercel handler — it lazily ensures the DB connection (cached promise) then delegates to `app`. Don't move startup side-effects into module top-level or you'll break serverless cold starts.

## Config / env

Required: `MONGODB_URI`. Optional but behavior-changing: `REDIS_URL` (enables cache layer), `SPOTIFY_CLIENT_ID`/`SECRET`, `LASTFM_API_KEY`, `SPOTIFY_FETCH_AUDIO_FEATURES` (costs extra API quota — keep off unless needed), `SCROBBLE_DEDUPE` (`off`/`window`), `DEBUG_WEBHOOKS`/`DEBUG_VALIDATION`, `ALLOWED_ORIGINS`, `NODE_ENV` (`production` changes logging + disables debug middleware). Multiple `.env.*` files exist for different targets (`.env.docker`, `.env.production`, `.env.local`); `.env.example` documents the full set.

## Migration

Legacy `tracks` → normalized (`artists` + `albums` + `trackmetas` + `scrobbles`):
```bash
bun run scripts/migrate-normalize.js --dry-run   # preview
bun run scripts/migrate-normalize.js             # real run — back up first
```
Or via UI at `/migrate` (streaming NDJSON progress) and `/inspect`. The `/api/migrate/run` handler is intentionally **not** wrapped in `asyncHandler` because it streams its own response.

## API docs

OpenAPI 3.0 spec is hand-maintained in `config/openapi.js` (a JS module, not a file read — so it bundles into the Vercel function). Served at `GET /openapi.json`; Swagger UI (CDN) at `GET /docs`. **When you add or change an endpoint in `index.js`/controllers, update `config/openapi.js` too** — it won't auto-sync. Endpoint parameter details also in `docs/analytics-api.md`; README.md (Thai) has the full feature reference.
