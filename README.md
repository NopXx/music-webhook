# Music Webhook Server

เซิร์ฟเวอร์สำหรับรับข้อมูลการฟังเพลงจากหลายแหล่ง (Web Scrobbler, ListenBrainz, Apple Music ฯลฯ) แล้วบันทึกลง MongoDB ในรูปแบบ **Normalized Schema** พร้อมระบบ enrichment จาก Spotify, Apple Music และ Last.fm พัฒนาโดยใช้ Express.js รันบน Bun.js

## ไฮไลต์สำคัญ
- 🎧 รับ webhook จาก Web Scrobbler และ ListenBrainz import format
- 💾 Normalized Database — แยกข้อมูลเป็น 4 collection หลัก: `Artist`, `Album`, `TrackMeta`, `Scrobble`
- 🎵 Spotify enrichment อัตโนมัติ — ปกอัลบั้ม, popularity, audio features, duration
- 🍎 Apple Music enrichment — ดึง animated artwork (วิดีโอพื้นหลัง) สำหรับเพลงที่รองรับ
- 🎸 Last.fm integration — ข้อมูลศิลปิน, อัลบั้ม, cover art และ MusicBrainz IDs
- 🛡️ มีระบบ validation, rate limit, security headers และ request logging
- 📊 REST API สำหรับดูสถิติ, รายการเพลงล่าสุด, สถานะ Now Playing
- ♻️ ป้องกันข้อมูลซ้ำ (dedupe), enrich ข้อมูลย้อนหลัง, เครื่องมือ migration จาก schema เก่า

## สถาปัตยกรรมฐานข้อมูล (Normalized Schema)

ระบบใช้ **Relational-style schema** บน MongoDB โดยแบ่งข้อมูลออกเป็น 4 collection หลัก แทนที่ monolithic `tracks` collection เดิม:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Artist    │◄────│    Album    │◄────│  TrackMeta  │◄────│  Scrobble   │
│             │     │             │     │             │     │             │
│ name        │     │ name        │     │ title       │     │ timestamp   │
│ nameLower   │     │ nameLower   │     │ titleLower  │     │ scrobbledAt │
│ imageUrl    │     │ artist (ref)│     │ artist (ref)│     │ track (ref) │
│ artistUrl   │     │ year        │     │ album (ref) │     │ source      │
│ lastfmMbid  │     │ trackArtUrl │     │ duration    │     │ connector   │
└─────────────┘     │ appleMusicUrl│    │ spotify {}  │     │ eventType   │
                    └─────────────┘     │ animationUrl│     │ isLoved     │
                                        │ appleMusicUrl│    │ rawData     │
                                        └─────────────┘     └─────────────┘

┌─────────────┐
│    Cache    │  ← TTL-based cache สำหรับ Apple Music / Spotify queries
│ key         │
│ data        │
│ expiresAt   │
└─────────────┘
```

| Collection | หน้าที่ | Unique Key |
|------------|---------|------------|
| **Artist** | ข้อมูลศิลปิน (ชื่อ, รูป, URL, MBID) | `nameLower` |
| **Album** | ข้อมูลอัลบัม (ชื่อ, ปกอาร์ต, ปี) | `nameLower` + `artist` |
| **TrackMeta** | เมตาดาต้าของเพลง (Spotify, animation, duration ฯลฯ) | `titleLower` + `artist` |
| **Scrobble** | รายการฟังแต่ละครั้ง (timestamp, source, connector) | — (ไม่มี unique, หนึ่งเพลงมีได้หลาย scrobble) |
| **Cache** | Cache ผลการค้นหา Apple Music / Spotify | `key` (TTL auto-expire) |

## โครงสร้างโปรเจกต์
```
.
├── index.js                        # Entry point — Express server, middleware, routes
├── config/
│   └── database.js                 # MongoDB connection manager
├── routes/
│   └── webhook.js                  # Route aggregator — maps controllers to endpoints
├── controllers/
│   ├── scrobbleController.js       # Scrobble intake, ListenBrainz import, loved status
│   ├── analyticsController.js      # Stats, leaderboards, track/album/artist analytics
│   ├── playerController.js         # Now Playing — get/set with ETag + Apple Music enrichment
│   ├── spotifyController.js        # Spotify status, enrich, update-missing, cache
│   └── systemController.js         # Health, duplicates, date-range delete, migration UI
├── services/
│   ├── scrobbleService.js          # Parse/normalize payloads, Spotify + Apple Music enrichment
│   ├── analyticsService.js         # Aggregation queries — stats, leaderboards, insights
│   ├── spotifyService.js           # Spotify API client (search, audio features, token mgmt)
│   ├── appleMusicService.js        # Apple Music / iTunes search + animated artwork fetcher
│   ├── nowPlayingService.js        # In-memory Now Playing state with heuristic timeout
│   ├── lastfm.js                   # Last.fm API client (track/artist/album info, images)
│   └── artistImageService.js       # Artist image resolver (Last.fm → UI Avatars fallback)
├── models/
│   ├── Artist.js                   # Artist schema + findOrCreateByName
│   ├── Album.js                    # Album schema + findOrCreateByNameAndArtist
│   ├── TrackMeta.js                # Track metadata + Spotify/animation data + helpers
│   ├── Scrobble.js                 # Scrobble events + findOrCreateScrobble pipeline
│   ├── Track.js                    # Legacy monolithic schema (pre-migration compat)
│   └── Cache.js                    # TTL key-value cache (Apple Music, Spotify)
├── middleware/
│   ├── validation.js               # Content-type, track data validation, ListenBrainz parser
│   └── debug.js                    # Development-only request/webhook logging
├── utils/
│   └── trackNormalizer.js          # Centralized normalization — dates, sources, cover art, metadata merge
├── scripts/
│   ├── migrate-normalize.js        # One-time migration: tracks → artists+albums+trackmetas+scrobbles
│   └── generate-placeholder.js     # Generate placeholder assets for public/
├── views/                          # EJS/HTML templates (ListenBrainz import UI, migration UI)
├── docs/
│   ├── analytics-api.md            # API reference สำหรับ analytics endpoints
│   ├── api.md                      # API overview
│   └── *.postman_collection.json   # Postman collection สำหรับทดสอบ
├── test/                           # Integration & unit test scripts
│   ├── test-webhook.js             # Webhook endpoint tests
│   ├── test-spotify.js             # Spotify integration tests
│   ├── test-enrichment.js          # Enrichment pipeline tests
│   ├── test-race-condition.js      # Race condition handling tests
│   ├── test-duplicates.js          # Dedup system tests
│   ├── quick-test.js               # Quick smoke test
│   ├── analyticsController.test.js # Analytics controller tests
│   ├── scrobbleService.test.js     # Scrobble service tests
│   ├── spotifyController.test.js   # Spotify controller tests
│   ├── cache.test.js               # Cache model tests
│   └── verify_*.js                 # Verification scripts
└── vercel.json                     # Vercel serverless deployment config
```

## การติดตั้ง
1. โคลนหรือดาวน์โหลดโปรเจกต์
2. ติดตั้ง dependencies
   ```bash
   cd music-webhook
   bun install
   ```
3. สร้างไฟล์ `.env` (คัดลอกจาก `.env.example` หรือกำหนดเอง)
   ```env
   PORT=3000
   HOST=localhost
   MONGODB_URI=mongodb://localhost:27017/music-scrobbler

   API_KEY=optional-api-key

   NODE_ENV=development

   # Spotify enrichment
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   SPOTIFY_FETCH_AUDIO_FEATURES=false

   # Last.fm (optional — สำหรับดึงรูปศิลปิน, cover art, bio)
   LASTFM_API_KEY=your_lastfm_api_key

   # Scrobble dedup
   SCROBBLE_DEDUPE=off

   # Debug
   DEBUG_WEBHOOKS=false
   DEBUG_VALIDATION=false
   ```
4. ตรวจสอบว่า MongoDB ทำงานอยู่ (local หรือ remote ก็ได้)

## การใช้งาน
- โหมดพัฒนา (hot reload)
  ```bash
  bun run dev
  ```
- โหมด production
  ```bash
  bun run start
  ```

## Scrobble Pipeline

เมื่อเซิร์ฟเวอร์ได้รับข้อมูล scrobble ระบบจะทำงานตาม pipeline นี้:

```
Webhook Request
      │
      ▼
 Validation Middleware (content-type, format detection, field extraction)
      │
      ▼
 ScrobbleService.parseScrobbleData() — normalize ทุกรูปแบบเป็น canonical format
      │
      ▼
 Scrobble.findOrCreateScrobble() — full normalized pipeline:
      │
      ├─ 1. Artist.findOrCreateByName()         → upsert Artist
      ├─ 2. Album.findOrCreateByNameAndArtist()  → upsert Album (optional)
      ├─ 3. TrackMeta.findOrCreateByIdentity()   → upsert TrackMeta
      ├─ 4. Dedup check (configurable window)
      └─ 5. Scrobble.create()                   → สร้างรายการฟังใหม่
      │
      ▼
 Background Enrichment (fire-and-forget):
      ├─ 🍎 Apple Music animated artwork → TrackMeta.animationUrl
      └─ 🎵 Spotify metadata             → TrackMeta.spotify {}
```

## แหล่งข้อมูลที่รองรับ

### 1. Web Scrobbler (บราวเซอร์ส่วนเสริม)
- ตั้งค่า URL ที่ `http://<host>:<port>/webhook/scrobble`
- ระบบรองรับทั้งรูปแบบเก่า (`track.title`, `track.artist`) และรูปแบบใหม่ (`eventName`, `data.song.processed`)

### 2. ListenBrainz Import Format
ส่ง JSON ที่มีฟิลด์ `inserted_at`, `listened_at`, `track_metadata` มายัง `/webhook/scrobble` ได้โดยตรง เช่น
```json
{
  "inserted_at": 1759922716.660063,
  "listened_at": 1733035913,
  "track_metadata": {
    "track_name": "Supernova Love",
    "artist_name": "IVE & David Guetta",
    "release_name": "Supernova Love",
    "mbid_mapping": {
      "recording_mbid": "f28e2528-210a-44c6-96e0-031d5c29cf85",
      "release_mbid": "d7a8fdca-a620-4517-819b-79b0ba4671ab"
    }
  }
}
```
ระบบจะเก็บ `source` เป็น `listenbrainz`, ใช้ `listened_at` เป็น timestamp หลัก และไม่อัปเดตสถานะ Now Playing หากเป็นข้อมูลย้อนหลังเกิน 5 นาที

### 3. Native App (iOS / macOS)
รองรับ payload จาก Apple Music client ผ่าน `/api/nowplaying/playing` และ `/webhook/scrobble` พร้อมส่งข้อมูลเสริม เช่น `animationUrl`, `masterTallUrl`, `primaryMediaUrl`

### เครื่องมือ Import แบบ UI
- เข้า URL `http://localhost:3000/import/listenbrainz`
- รองรับการวาง JSON ปกติหรือ JSON Lines, รวมถึงการอัปโหลดไฟล์ `.json` / `.jsonl`
- ใช้ parser ตัวเดียวกับ webhook เดิม จึงมีการคิว enrichment Spotify และ validation ครบ
- แสดงสรุปจำนวนที่สร้าง/อัปเดต/ข้าม พร้อมแสดง error ต่อบรรทัด

## REST API หลัก

### Scrobble & Import
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| POST   | `/webhook/scrobble` | รับข้อมูล scrobble/nowplaying (ทุกฟอร์แมต) |
| POST   | `/api/import/listenbrainz` | นำเข้าข้อมูล ListenBrainz (JSON / JSON Lines) แบบ bulk |
| PATCH  | `/api/tracks` | อัปเดตสถานะ Loved ของเพลง (`{ id, isLoved }`) |

### Now Playing
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET    | `/api/nowplaying` | ดูสถานะ Now Playing (รองรับ ETag / 304 Not Modified) |
| POST   | `/api/nowplaying/playing` | ตั้ง/อัปเดตสถานะ Now Playing พร้อม Apple Music enrichment |

### Analytics & Data
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET    | `/api/stats?range=week` | สถิติรวม + ตัวเลือก range/offset + Spotify stats |
| GET    | `/api/tracks?page=1&limit=50&search=` | รายการเพลงทั้งหมดพร้อมค้นหา/จัดเรียง/กรอง |
| GET    | `/api/tracks/top-artists?range=month&limit=10` | Leaderboard ศิลปินยอดนิยม |
| GET    | `/api/tracks/top-tracks?range=month&limit=15` | Leaderboard เพลงยอดนิยม |
| GET    | `/api/track?artist=<name>&title=<title>` | Analytics เพลงเดี่ยว (distribution, connectors, Spotify) |
| GET    | `/api/albums?artist=<name>&album=<album>` | สถิติอัลบัม + timeline |
| GET    | `/api/artists/:name` | โปรไฟล์ศิลปิน (top tracks/albums, timeline, recent) |

### Spotify Integration
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET    | `/api/spotify/status` | ดูค่าคอนฟิก Spotify ปัจจุบัน |
| GET    | `/api/spotify/stats` | ดูจำนวนที่ enrich สำเร็จ/รอคิว (อ่านจาก TrackMeta) |
| POST   | `/api/spotify/enrich?limit=10&force=false` | บังคับ enrich ข้อมูลล่าสุด |
| POST   | `/api/spotify/update-missing?missingOnly=true` | เติมข้อมูลที่ยังขาด (duration, album, year ฯลฯ) |
| DELETE | `/api/spotify/cache` | ล้าง cache คำค้นหา Spotify |

### System & Maintenance
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET    | `/api/health` | ตรวจสอบสถานะเซิร์ฟเวอร์ |
| GET    | `/api/duplicates` | สำรวจข้อมูลซ้ำ |
| DELETE | `/api/duplicates?dryRun=true` | ลบหรือพรีวิวข้อมูลซ้ำ |
| DELETE | `/api/tracks/range?start=<ISO>&end=<ISO>&dryRun=true` | ลบข้อมูลตามช่วงวันที่ (รองรับกรอง source/connector) |

### Migration (Legacy → Normalized)
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET    | `/migrate` | UI สำหรับ migration แบบ interactive |
| GET    | `/inspect` | UI สำหรับตรวจสอบข้อมูลและสถานะ migration |
| GET    | `/api/migrate/precheck` | ตรวจสอบความพร้อมก่อน migration |
| POST   | `/api/migrate/run` | รัน migration (streaming response) |

> 📚 รายละเอียดพารามิเตอร์ของ endpoint ชุดสถิติ/analytics ดูเพิ่มได้ใน `docs/analytics-api.md`

## Data Enrichment

### Spotify
- ค้นหาเพลงจาก Spotify API แล้วบันทึกลง `TrackMeta.spotify` (id, uri, url, popularity, album images, artists ฯลฯ)
- เสริม duration, track number, album year จาก Spotify หากข้อมูลขาดหาย
- รองรับ Audio Features (danceability, energy, tempo ฯลฯ) เมื่อเปิด `SPOTIFY_FETCH_AUDIO_FEATURES=true`
- ผลการค้นหาถูก cache เพื่อลด API calls

### Apple Music (Animated Artwork)
- ค้นหาเพลงจาก iTunes Search API ด้วย multi-country parallel search (US, TH, JP, KR)
- ดึง animated artwork (วิดีโอ 1080p) ผ่าน third-party API
- บันทึก `animationUrl`, `appleMusicUrl` ลง TrackMeta
- ผลทั้ง URL search และ artwork ถูก cache ใน MongoDB (TTL 30 วัน)
- ใช้สำหรับ Now Playing background animation ในแอพ client

### Last.fm
- ดึงข้อมูลเสริม: รูปศิลปิน, cover art, bio, tags, MusicBrainz IDs
- Fallback ไป UI Avatars เมื่อไม่มี API key หรือไม่พบรูป

## สถาปัตยกรรมและ Middleware
- **validation.js** — ตรวจสอบ content-type, รูปแบบข้อมูล (Web Scrobbler, ListenBrainz, legacy) และสร้าง `req.validatedTrack`
- **trackNormalizer.js** — centralized normalization: วันที่, source, metadata merge, cover art derivation, album name cleaning
- **scrobbleService.js** — parse payloads ทุกรูปแบบ, Spotify + Apple Music enrichment pipelines
- **nowPlayingService.js** — จัดการสถานะ Now Playing แบบ in-memory พร้อม heuristic timeout และ ETag support
- **appleMusicService.js** — iTunes Search + animated artwork fetcher พร้อม MongoDB-backed cache

## การตั้งค่าเพิ่มเติม

| ตัวแปร | คำอธิบาย | ค่า default |
|--------|---------|-------------|
| `SCROBBLE_DEDUPE` | ระบบกันข้อมูลซ้ำ (`off` / `window`) | `off` |
| `DEBUG_VALIDATION` | เปิด log การตรวจสอบข้อมูลที่เข้ามา | `false` |
| `DEBUG_WEBHOOKS` | เปิด log ข้อมูล webhook ดิบ | `false` |
| `NODE_ENV` | `production` จะเปลี่ยน behavior ของ logging และ middleware | `development` |
| `SPOTIFY_FETCH_AUDIO_FEATURES` | ดึง audio features จาก Spotify (เพิ่ม API calls) | `false` |
| `LASTFM_API_KEY` | API key สำหรับ Last.fm (optional) | — |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `*` |

## Migration จาก Schema เก่า

หากมีข้อมูลอยู่ใน monolithic `tracks` collection เดิม สามารถ migrate มาเป็น normalized schema ได้:

### ผ่าน CLI
```bash
# Preview (ไม่เขียนข้อมูล)
bun run scripts/migrate-normalize.js --dry-run

# รัน migration จริง (สำรองข้อมูลก่อน!)
bun run scripts/migrate-normalize.js
```

### ผ่าน Web UI
1. เปิด `http://localhost:3000/migrate`
2. กด Precheck เพื่อตรวจสอบความพร้อม
3. กด Run Migration — ระบบจะแสดง progress แบบ streaming

Migration จะแปลงข้อมูลจาก `tracks` → `artists` + `albums` + `trackmetas` + `scrobbles` พร้อมย้าย Spotify data, Apple Music animation data, และ metadata ทั้งหมด

## การดีพลอย
- รองรับ deploy บน Vercel (serverless) ผ่าน `vercel.json`
- ตรวจสอบ environment variables ให้ครบ โดยเฉพาะ `MONGODB_URI`

## Scripts ที่มีให้

```bash
bun run dev                  # Development mode (hot reload)
bun run start                # Production mode
bun run test                 # รันชุดทดสอบหลัก
bun run test:spotify         # ทดสอบ Spotify integration
bun run test:enrichment      # ทดสอบ enrichment pipeline
bun run test:race            # ทดสอบ race condition handling
bun run test:new             # ทดสอบ format ใหม่
bun run test:metadata        # ทดสอบ metadata parsing
bun run test:duplicates      # ทดสอบระบบ dedupe
bun run test:update-missing  # ทดสอบ update-missing flow
bun run quick-test           # Quick smoke test
```

## ทิปและแนวทางปฏิบัติ
- หากใช้ Spotify ให้เปิด `SPOTIFY_FETCH_AUDIO_FEATURES=true` เฉพาะตอนต้องการข้อมูลเชิงลึก เพราะใช้ quota เพิ่ม
- สร้าง index ใน MongoDB ตามที่ schema กำหนดแล้ว เพื่อให้ query ทำงานเร็วขึ้น
- สามารถเพิ่มระบบ auth/API key เพิ่มเติมได้ที่ middleware `validateApiKey`
- Album name จะถูก normalize อัตโนมัติ (ตัด `-EP`, `(Single)`, `(Deluxe Version)` ฯลฯ) เพื่อให้การรวมกลุ่มแม่นยำขึ้น
- ระบบ race condition ป้องกันการสร้าง duplicate ด้วย MongoDB unique index + `findOrCreate` pattern พร้อม error code 11000 handling

## การมีส่วนร่วม
ยินดีต้อนรับการปรับแต่ง เพิ่มฟีเจอร์ และแชร์สคริปต์ทดสอบใหม่ๆ  
ถ้าพบปัญหาหรือมีไอเดียใหม่สามารถเปิด issue/PR ได้ทันที

---
พัฒนาเพื่อให้การเก็บประวัติการฟังเพลงเป็นเรื่องง่าย สนุก และมีข้อมูลครบถ้วน พร้อมต่อยอดวิเคราะห์ต่อได้ทันที 🎶
