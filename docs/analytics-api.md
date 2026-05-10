# Analytics API Documentation

ชุด API endpoint สำหรับสํารวจและจัดการข้อมูลการฟังเพลงใน MongoDB  
ทุก endpoint รองรับ `Accept: application/json` และได้รับการคุ้มครองด้วย middleware (rate limit, logging)

---

## พารามิเตอร์ร่วม

| ชื่อ | ประเภท | คำอธิบาย |
|------|--------|-----------|
| `range` | `string` | เลือกหน้าต่างเวลา: `week` (ดีฟอลต์), `month`, `year`, `all-time` |
| `offset` | `number` | เลื่อนช่วงเวลาเป็นจำนวนหน้าต่างก่อนหน้า เช่น `offset=1` คือสัปดาห์ก่อนหน้า |
| `tz` | `string` | กำหนด timezone (เช่น `Asia/Bangkok`) สำหรับการตัดรอบวันที่ |
| `recentLimit` | `number` | จำนวนรายการล่าสุดที่ต้องการดึงมา (ใช้กับ track/album/artist analytics) |

---

## Root & Info

### 1) GET `/`

**คำอธิบาย:** Welcome message พร้อมรายการ endpoint และฟีเจอร์

**Response:**

```json
{
  "message": "Music Webhook Server",
  "version": "1.0.0",
  "framework": "Express.js + Bun.js",
  "features": [
    "Multiple webhook formats (Web Scrobbler, ListenBrainz, custom JSON)",
    "Duplicate prevention & Spotify enrichment queue",
    "In-memory Now Playing state with refresh endpoints",
    "ListenBrainz bulk import UI + API"
  ],
  "endpoints": { ... },
  "notes": [ ... ]
}
```

### 2) GET `/api`

**คำอธิบาย:** Dynamic JSON listing ของทุก endpoint ที่มี

**Response:**

```json
{
  "message": "Music Webhook API",
  "version": "1.0.0",
  "endpoints": {
    "GET /api/stats": "Get scrobbling statistics",
    "GET /api/tracks": "Get tracks with pagination/search",
    ...
  }
}
```

---

## Statistics & Overview

### 3) GET `/api/stats`

**คำอธิบาย:** ดึงสถิติรวมของการฟังเพลงในช่วงเวลาที่กำหนด

**Query Parameters:**
- `range` - ช่วงเวลา (week, month, year, all-time)
- `offset` - เลื่อนช่วงเวลา (0 = ปัจจุบัน, 1 = ช่วงก่อนหน้า)
- `recentLimit` - จำนวนรายการล่าสุด (default: 10, max: 25)
- `topArtistLimit` - จำนวน top artists (default: 5)
- `tz` - timezone

**Query:** `?range=week&offset=0&recentLimit=10&topArtistLimit=5`  
**Response:** สรุปรวมจำนวนเพลง/ศิลปิน/เพลย์, ระยะเวลาฟังเฉลี่ย, connector ยอดนิยม, รายการล่าสุด พร้อมสถิติ Spotify (ถ้าเปิดไว้)

**ตัวอย่าง Response:**

```json
{
  "range": {
    "range": "week",
    "offset": 0,
    "start": "2025-01-01T00:00:00.000Z",
    "end": "2025-01-08T00:00:00.000Z"
  },
  "totals": {
    "totalPlays": 420,
    "uniqueTracks": 310,
    "uniqueArtists": 120,
    "totalDurationSeconds": 54210,
    "averageDurationSeconds": 180
  },
  "connectors": [{ "connector": "youtube", "plays": 160 }],
  "topArtists": [{ "artist": "IVE", "plays": 30 }],
  "recentScrobbles": [{ "artist": "David Guetta", "title": "Supernova Love" }],
  "lastScrobble": "2025-01-08T10:00:00.000Z",
  "spotify": {
    "configured": true,
    "enrichment_rate": 82,
    "match_rate": 88,
    "pending": 500
  }
}
```

---

## Tracks Management

### 4) GET `/api/tracks`

**คำอธิบาย:** ดึงรายการเพลงทั้งหมดพร้อม pagination, sorting และ search

**Query Parameters:**
- `page` - เลขหน้า (default: 1)
- `limit` - จำนวนต่อหน้า (default: 50, max: 100)
- `offset` - offset สำหรับ skip
- `sortBy` - เรียงตาม: `scrobbledAt`, `artist`, `title` (default: `scrobbledAt`)
- `order` - ลำดับ: `asc` หรือ `desc` (default: `desc`)
- `search` - ค้นหาจากชื่อเพลง, ศิลปิน, หรืออัลบั้ม (general search)
- `searchTitle` - ค้นหาเฉพาะชื่อเพลง
- `searchArtist` - ค้นหาเฉพาะชื่อศิลปิน
- `searchAlbum` - ค้นหาเฉพาะชื่ออัลบั้ม
- `connector` - กรองตาม connector (e.g. youtube, spotify)
- `source` - กรองตาม source
- `range` - กรองตามช่วงเวลา (week, month, year, all-time)
- `rangeOffset` - เลื่อนช่วงเวลา

**ตัวอย่าง:**
```
GET /api/tracks?page=1&limit=50&sortBy=scrobbledAt&order=desc&search=IVE
GET /api/tracks?searchArtist=IVE&connector=youtube&range=month
```

**Response:**
```json
{
  "tracks": [...],
  "pagination": {
    "currentPage": 1,
    "totalPages": 10,
    "totalItems": 500,
    "itemsPerPage": 50
  },
  "meta": {
    "sortBy": "scrobbledAt",
    "order": "desc",
    "search": "IVE"
  },
  "range": {
    "start": "...",
    "end": "..."
  }
}
```

### 5) PATCH `/api/tracks`

**คำอธิบาย:** อัปเดตสถานะ "Loved" ของ scrobble

**Request Body:**
```json
{
  "id": "<scrobbleId>",
  "isLoved": true
}
```

**Response:** คืนค่า updated scrobble object

**ตัวอย่าง:**
```bash
curl -X PATCH https://your-api.com/api/tracks \
  -H "Content-Type: application/json" \
  -d '{"id": "507f1f77bcf86cd799439011", "isLoved": true}'
```

### 6) DELETE `/api/tracks/range`

**คำอธิบาย:** ลบ scrobbles ทั้งหมดในช่วงวันที่ที่กำหนด

**Query Parameters:**
- `start` - วันเริ่มต้น (ISO 8601 format, required)
- `end` - วันสิ้นสุด (ISO 8601 format, required)
- `source` - กรองตาม source (optional)
- `connector` - กรองตาม connector (optional)
- `dryRun` - preview โดยไม่ลบจริง (`true`/`false`)

**ตัวอย่าง:**
```
# Preview ก่อนลบ
DELETE /api/tracks/range?start=2025-01-01&end=2025-01-07&dryRun=true

# ลบเฉพาะ youtube connector
DELETE /api/tracks/range?start=2025-01-01&end=2025-01-07&connector=youtube
```

**Response (Dry Run):**
```json
{
  "success": true,
  "message": "Dry run: ไม่ได้ลบข้อมูล",
  "matches": 150,
  "filter": {
    "scrobbledAt": { "$gte": "2025-01-01T00:00:00.000Z", "$lte": "2025-01-07T23:59:59.999Z" }
  }
}
```

**Response (Actual Delete):**
```json
{
  "success": true,
  "message": "ลบข้อมูลสำเร็จ 150 รายการ",
  "deletedCount": 150,
  "filter": { ... },
  "requestedRange": {
    "start": "2025-01-01T00:00:00.000Z",
    "end": "2025-01-07T23:59:59.999Z"
  },
  "totalMatchedBeforeDelete": 150
}
```

---

## Leaderboards & Rankings

### 7) GET `/api/tracks/top-artists`

**คำอธิบาย:** ดึงรายการศิลปินยอดนิยมพร้อม metadata และรูปภาพ

**Query Parameters:**
- `range`, `offset` - กรองตามช่วงเวลา
- `limit` - จำนวนศิลปิน (default: 10, max: 100)

**ตัวอย่าง Response:**
```json
{
  "window": { 
    "range": "month", 
    "start": "2025-01-01T00:00:00.000Z", 
    "end": "2025-02-01T00:00:00.000Z" 
  },
  "items": [
    {
      "artist": "NewJeans",
      "plays": 58,
      "latestTrack": {
        "title": "How Sweet",
        "album": "How Sweet",
        "scrobbledAt": "2025-01-31T08:15:00.000Z",
        "trackArtUrl": "https://..."
      },
      "artistImage": "https://..."
    }
  ]
}
```

### 8) GET `/api/tracks/top-tracks`

**คำอธิบาย:** จัดอันดับเพลงยอดนิยมพร้อม metadata (track art/animation)

**Query Parameters:**
- `range`, `offset` - กรองตามช่วงเวลา
- `limit` - จำนวนเพลง (default: 15, max: 100)

**Response Structure:**
```json
{
  "window": { "range": "week", "start": "...", "end": "..." },
  "items": [
    {
      "artist": "IVE",
      "title": "HEYA",
      "plays": 42,
      "metadata": {
        "album": "IVE SWITCH",
        "trackArtUrl": "https://...",
        "trackAnimationUrl": "https://...",
        "duration": 180
      },
      "lastPlayed": "2025-01-31T20:00:00.000Z"
    }
  ]
}
```

---

## Detailed Analytics

### 9) GET `/api/track`

**คำอธิบาย:** วิเคราะห์เชิงลึกสำหรับเพลงเดียว

**Query Parameters (Required):**
- `artist` - ชื่อศิลปิน
- `title` - ชื่อเพลง

**Query Parameters (Optional):**
- `recentLimit` - จำนวน scrobbles ล่าสุดที่จะดึง (default: 12)
- `tz` - timezone

**ข้อมูลที่ได้รับ:**
- **Summary:** จำนวน scrobbles, loved count, first/last play, average duration
- **Time Distribution:** การกระจายตามชั่วโมง (0-23), วัน (1-7), เดือน
- **Breakdown:** แยกตาม connector, source, user-agent
- **Recent Scrobbles:** รายการล่าสุด
- **Spotify Metadata:** ข้อมูลจาก Spotify (ถ้ามี)
- **Related Tracks:** เพลงอื่นๆ ของศิลปินเดียวกัน

**ตัวอย่าง:**
```
GET /api/track?artist=IVE&title=HEYA&recentLimit=10
```

**Response:**
```json
{
  "meta": {
    "artist": "IVE",
    "title": "HEYA",
    "timezone": "Asia/Bangkok"
  },
  "summary": { ... },
  "timeDistribution": { ... },
  "breakdown": { ... },
  "recentScrobbles": [ ... ],
  "spotify": { ... },
  "relatedTracks": [ ... ]
}
```

### 10) GET `/api/albums`

**คำอธิบาย:** วิเคราะห์ข้อมูลอัลบั้มเฉพาะ

**Query Parameters (Required):**
- `artist` - ชื่อศิลปิน
- `album` - ชื่ออัลบั้ม

**Query Parameters (Optional):**
- `recentLimit` - จำนวน scrobbles ล่าสุด (default: 12)
- `tz` - timezone

**ข้อมูลที่ได้รับ:**
- Summary: จำนวนครั้งที่เล่น, first/last play, average duration
- Track List: รายชื่อเพลงในอัลบั้มพร้อมจำนวนครั้งและความยาวเฉลี่ย
- Connector Breakdown: แยกตาม connector
- Timeline: กราฟรายวันช่วง 30 วันย้อนหลัง
- Recent Scrobbles: รายการล่าสุด
- Album Art: ภาพปกล่าสุด

**ตัวอย่าง:**
```
GET /api/albums?artist=IVE&album=IVE SWITCH&recentLimit=10
```

### 11) GET `/api/artists/:name`

**คำอธิบาย:** โปรไฟล์ศิลปินแบบละเอียด

**Path Parameter:**
- `name` - ชื่อศิลปิน (URI encoded)

**Query Parameters:**
- `tz` - timezone
- `limit` - จำนวน top tracks/albums (default: 10)
- `recentLimit` - จำนวน scrobbles ล่าสุด (default: 15)

**ข้อมูลที่ได้รับ:**
- Summary: total plays, unique tracks, unique albums
- Top Tracks: เพลงยอดนิยมของศิลปิน
- Top Albums: อัลบั้มยอดนิยม
- Connector Breakdown: แยกตาม source
- Timeline: 30-day play history
- Recent Scrobbles: รายการล่าสุด
- Artist Image: รูปศิลปิน (จาก Last.fm API หรือ fallback avatar)

**ตัวอย่าง:**
```
GET /api/artists/NewJeans?limit=5&recentLimit=10
```

**Response:**
```json
{
  "artist": "NewJeans",
  "timezone": "Asia/Bangkok",
  "summary": { ... },
  "topTracks": [ ... ],
  "topAlbums": [ ... ],
  "connectorBreakdown": [ ... ],
  "timeline": [ ... ],
  "recentScrobbles": [ ... ],
  "artistImage": "https://..."
}
```

---

## Now Playing

### 12) GET `/api/nowplaying`

**คำอธิบาย:** ดึงข้อมูลสถานะกำลังเล่นปัจจุบัน (in-memory)  
รองรับ ETag / 304 Not Modified สำหรับ efficient polling

**Headers:**
- `If-None-Match` - ส่ง ETag จาก response ก่อนหน้า เพื่อรับ 304 เมื่อสถานะไม่เปลี่ยน

**Response (Playing):**
```json
{
  "playing": true,
  "status": "playing",
  "track": {
    "title": "HEYA",
    "artist": "IVE",
    "album": "IVE SWITCH",
    "trackArtUrl": "https://...",
    "animationUrl": "https://...",
    "appleMusicUrl": "https://..."
  },
  "trackArtUrl": "https://...",
  "startedAt": "2025-01-31T10:00:00.000Z",
  "updatedAt": "2025-01-31T10:05:00.000Z"
}
```

**Response (Not Playing):**
```json
{
  "playing": false,
  "status": "idle",
  "updatedAt": "2025-01-31T09:00:00.000Z",
  "track": null
}
```

### 13) POST `/api/nowplaying/playing`

**คำอธิบาย:** อัปเดตสถานะกำลังเล่นปัจจุบัน (manual set/refresh)

**Request Body:**
```json
{
  "state": "playing",
  "track": {
    "title": "HEYA",
    "artist": "IVE",
    "album": "IVE SWITCH",
    "trackArtUrl": "https://...",
    "duration": 180
  }
}
```

**State values:** `playing`, `paused`, `stopped`

**Headers:**
```
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "message": "Now playing status updated to playing",
  "playing": true,
  "status": "playing",
  "track": { ... },
  "startedAt": "2025-01-31T10:00:00.000Z",
  "updatedAt": "2025-01-31T10:00:00.000Z"
}
```

**Additional:** เมื่อ state เป็น `playing` ระบบจะ fire-and-forget enrich Apple Music animated artwork ใน background

---

## Import & Migration

### 14) GET `/import/listenbrainz`

**คำอธิบาย:** หน้าเว็บ UI สำหรับนำเข้าข้อมูลจาก ListenBrainz

**Response:** HTML page พร้อมฟอร์มอัพโหลด

### 15) POST `/api/import/listenbrainz`

**คำอธิบาย:** นำเข้าข้อมูล scrobbles จาก ListenBrainz export

**Request Body:** รองรับหลายรูปแบบ
- JSON array ของ ListenBrainz entries
- Object ที่มี `entries` array
- Object ที่มี `track_metadata` (single entry)
- Object ที่มี `raw` field (JSON string หรือ JSON Lines)
- Array โดยตรง

**Headers:**
```
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "message": "นำเข้าข้อมูลสำเร็จ",
  "total": 1500,
  "processed": 1500,
  "created": 1480,
  "updated": 0,
  "skipped": 20,
  "ignored": 0,
  "spotifyQueued": 1480,
  "errors": [],
  "items": {
    "created": [
      { "id": "...", "title": "HEYA", "artist": "IVE", "album": "IVE SWITCH", "timestamp": "...", "connector": "listenbrainz", "source": "listenbrainz", "trackArtUrl": "https://..." }
    ],
    "updated": [],
    "skipped": [],
    "ignored": []
  }
}
```

**Note:** HTTP 207 Multi-Status เมื่อมีบางรายการ import สำเร็จแต่บางรายการมี error

---

## Duplicates Management

### 16) GET `/api/duplicates`

**คำอธิบาย:** ดึงสถิติและรายการเพลงที่ซ้ำกัน (same artist, title, connector) แสดง top 20

**Response:**
```json
{
  "duplicateGroups": 45,
  "totalStats": {
    "totalDuplicateGroups": 45,
    "totalDuplicateTracks": 67
  },
  "topDuplicates": [
    {
      "_id": { "artist": "IVE", "title": "HEYA", "connector": "youtube" },
      "count": 3,
      "tracks": [
        { "id": "...", "scrobbledAt": "2025-01-31T10:02:00.000Z", "eventType": "scrobble" },
        { "id": "...", "scrobbledAt": "2025-01-31T10:00:00.000Z", "eventType": "scrobble" }
      ]
    }
  ],
  "endpoints": {
    "removeDuplicates": "DELETE /api/duplicates?dryRun=true",
    "removeDuplicatesForReal": "DELETE /api/duplicates"
  }
}
```

### 17) DELETE `/api/duplicates`

**คำอธิบาย:** ลบ scrobbles ที่ซ้ำกัน (เก็บเฉพาะรายการล่าสุด) — dupes ที่มี track, connector เดียวกัน และ scrobbledAt ห่างกันไม่เกิน 5 นาที

**Query Parameters:**
- `dryRun` - preview โดยไม่ลบจริง (true/false, default: false)
- `details` - แสดงรายละเอียดกลุ่มที่ซ้ำ (true/false)

**ตัวอย่าง:**
```
# Preview ก่อนลบ
DELETE /api/duplicates?dryRun=true&details=true

# ลบจริง
DELETE /api/duplicates
```

**Response (Dry Run):**
```json
{
  "success": true,
  "dryRun": true,
  "duplicateGroups": 45,
  "tracksToRemove": 67,
  "duplicates": [
    {
      "trackId": "...",
      "connector": "youtube",
      "totalCount": 3,
      "keepTrackId": "...",
      "removeTrackIds": ["...", "..."],
      "keepTrackDate": "2025-01-31T10:02:00.000Z"
    }
  ],
  "message": "Found 67 duplicate tracks that would be removed"
}
```

**Response (Actual Delete):**
```json
{
  "success": true,
  "dryRun": false,
  "duplicateGroups": 45,
  "tracksToRemove": 67,
  "message": "Removed 67 duplicate tracks"
}
```

---

## Spotify Integration

### 18) GET `/api/spotify/status`

**คำอธิบาย:** ตรวจสอบสถานะการเชื่อมต่อ Spotify

**Response:**
```json
{
  "configured": true,
  "client_id_set": true,
  "client_secret_set": true,
  "audio_features_enabled": false,
  "cache": {
    "size": 150,
    "maxSize": 1000
  },
  "message": "Spotify integration is configured and ready"
}
```

### 19) GET `/api/spotify/stats`

**คำอธิบาย:** สถิติการ enrich ข้อมูลจาก Spotify

**Response:**
```json
{
  "total": 5000,
  "spotify_enriched": 4100,
  "spotify_search_attempted": 4700,
  "spotify_match_found": 4500,
  "enrichment_rate_percent": 82,
  "match_rate_percent": 96,
  "pending_enrichment": 300,
  "cache_stats": {
    "size": 150,
    "maxSize": 1000
  }
}
```

### 20) POST `/api/spotify/enrich`

**คำอธิบาย:** Enrich tracks ด้วยข้อมูล Spotify (manual trigger)

**Query Parameters:**
- `limit` - จำนวน tracks ที่จะ enrich (default: 10, max: 50)
- `force` - บังคับ re-enrich แม้มีข้อมูลอยู่แล้ว (`true`/`false`)

**Response:**
```json
{
  "message": "Spotify enrichment completed",
  "processed": 50,
  "enriched": 45,
  "errors": 5,
  "force_mode": false
}
```

### 21) POST `/api/spotify/update-missing`

**คำอธิบาย:** อัปเดตข้อมูล Spotify ที่ขาดหายไปใน tracks ที่มีอยู่

**Query Parameters:**
- `limit` - จำนวน tracks ที่จะอัปเดต (default: 50, max: 100)
- `missingOnly` - อัปเดตเฉพาะ tracks ที่ขาดข้อมูลพื้นฐาน (`true`/`false`)
- `force` - บังคับอัปเดตทั้งหมดโดยไม่เช็ค condition (`true`/`false`)
- `priority` - fields ที่ต้องการให้ priority (comma-separated, default: `duration,album,year`)

**Response:**
```json
{
  "success": true,
  "message": "Spotify data update completed",
  "processed": 100,
  "enriched": 85,
  "no_match": 10,
  "errors": 5,
  "fields_updated": {
    "duration": 50,
    "album": 30,
    "year": 25,
    "trackNumber": 15
  },
  "updated_fields_summary": "duration: 50, album: 30, year: 25, trackNumber: 15",
  "query_options": {
    "limit": 100,
    "missing_data_only": true,
    "force_update": false,
    "priority_fields": "duration,album,year"
  }
}
```

### 22) DELETE `/api/spotify/cache`

**คำอธิบาย:** ล้าง search cache ของ Spotify service

**Response:**
```json
{
  "message": "Spotify cache cleared",
  "cleared_entries": 150
}
```

---

## Health & System

### 23) GET `/health` หรือ `/api/health`

**คำอธิบาย:** ตรวจสอบสถานะระบบและ database connectivity

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-31T10:00:00.000Z",
  "database": "connected",
  "version": "1.0.0",
  "uptime": 86400
}
```

**Error Response (database down):**
```json
{
  "status": "unhealthy",
  "timestamp": "2025-01-31T10:00:00.000Z",
  "database": "disconnected",
  "error": "Connection timeout"
}
```

---

## Webhook Endpoints

### 24) POST `/webhook/scrobble`

**คำอธิบาย:** รับข้อมูลจาก external services รองรับ Web Scrobbler, ListenBrainz และ custom format

**Request Body:** รองรับหลายรูปแบบ
- Web Scrobbler format
- ListenBrainz format
- Custom format

**Headers:**
```
Content-Type: application/json
User-Agent: <connector-name>
```

**Event Types & Responses:**

#### `nowplaying` — แจ้งว่ากำลังเล่น (ไม่นับเป็น scrobble)
```json
{
  "success": true,
  "message": "Now playing updated",
  "nowPlaying": { "playing": true, "track": { ... } },
  "track": { "title": "HEYA", "artist": "IVE", "album": "IVE SWITCH" }
}
```

#### `paused` / `stopped` — อัปเดต now playing state โดยไม่บันทึก scrobble
```json
{
  "success": true,
  "action": "ignored",
  "message": "Now playing paused",
  "nowPlaying": { "playing": false, "status": "paused", ... },
  "track": { "title": "HEYA", "artist": "IVE" }
}
```

#### `scrobble` — บันทึกเป็น scrobble ใหม่
```json
{
  "success": true,
  "action": "created",
  "scrobble": {
    "_id": "...",
    "track": "...",
    "scrobbledAt": "2025-01-31T10:00:00.000Z",
    "source": "web-scrobbler",
    "connector": "youtube",
    "eventType": "scrobble"
  },
  "message": "Scrobble received successfully"
}
```

#### Duplicate (ถูกข้าม)
```json
{
  "success": true,
  "action": "skipped",
  "message": "Duplicate scrobble skipped",
  "track": { "title": "HEYA", "artist": "IVE" }
}
```

### 25) POST `/webhook`

**คำอธิบาย:** Alias ของ `/webhook/scrobble` — พฤติกรรมเหมือนกันทุกประการ

---

## Migration

### 26) GET `/migrate`

**คำอธิบาย:** หน้าเว็บ UI สำหรับ migrate ข้อมูลจาก collection `tracks` เดิม → normalized schema (Artist, Album, TrackMeta, Scrobble)

**Response:** HTML page

### 27) GET `/inspect`

**คำอธิบาย:** หน้าเว็บ UI สำหรับ inspect ข้อมูลใน database

**Response:** HTML page

### 28) GET `/api/migrate/precheck`

**คำอธิบาย:** เช็คจำนวน documents ใน old tracks collection เทียบกับ new normalized collections

**Response:**
```json
{
  "success": true,
  "counts": {
    "oldTracks": 5000,
    "artists": 120,
    "albums": 200,
    "trackMetas": 310,
    "scrobbles": 0
  }
}
```

### 29) POST `/api/migrate/run`

**คำอธิบาย:** รัน migration จาก `tracks` → normalized schema แบบ streaming (NDJSON)

**Request Body:**
```json
{
  "dryRun": true
}
```

`dryRun` — ถ้า `true` (default) จะ simulate โดยไม่เขียนลง database จริง

**Headers:**
```
Content-Type: application/json
```

**Response:** Streaming NDJSON (application/x-ndjson)

```
{"type":"start","total":5000}
{"type":"progress","processed":300,"total":5000,"pct":"6.0","artists":50,"albums":80,"trackMetas":120,"scrobbles":300,"errors":0}
{"type":"progress","processed":600,"total":5000,"pct":"12.0","artists":90,"albums":150,"trackMetas":200,"scrobbles":600,"errors":0}
...
{"type":"done","total":5000,"processed":5000,"artists":120,"albums":200,"trackMetas":310,"scrobbles":5000,"errors":5}
```

---

## Notes

> **Rate Limiting:** ทุก endpoint มี rate limit ป้องกันการใช้งานมากเกินไป (1000 req/15min ทั่วไป, 100 req/min สำหรับ `/webhook`)
>
> **Authentication:** ปัจจุบันไม่ต้องการ API key แต่สามารถเพิ่ม middleware `validateApiKey` ได้
>
> **CORS:** รองรับ Cross-Origin requests
>
> **Error Handling:** ทุก endpoint คืนค่า error ในรูปแบบ JSON:
> ```json
> {
>   "error": "Error message",
>   "code": "ERROR_CODE",
>   "details": {...}
> }
> ```

---

## Quick Start Examples

### ดึงสถิติสัปดาห์นี้
```bash
curl "https://your-api.com/api/stats?range=week"
```

### ค้นหาเพลงของ IVE (general search)
```bash
curl "https://your-api.com/api/tracks?search=IVE&limit=20"
```

### ค้นหาเฉพาะชื่อศิลปิน
```bash
curl "https://your-api.com/api/tracks?searchArtist=IVE&connector=youtube&range=month"
```

### ดูข้อมูลเพลงเฉพาะ
```bash
curl "https://your-api.com/api/track?artist=IVE&title=HEYA"
```

### ดู Top Artists เดือนนี้
```bash
curl "https://your-api.com/api/tracks/top-artists?range=month&limit=10"
```

### ส่ง now playing status
```bash
curl -X POST "https://your-api.com/api/nowplaying/playing" \
  -H "Content-Type: application/json" \
  -d '{"state":"playing","track":{"title":"HEYA","artist":"IVE","album":"IVE SWITCH"}}'
```

### Preview ก่อนลบ duplicates
```bash
curl "https://your-api.com/api/duplicates?dryRun=true&details=true"
```

### ส่ง scrobble ใหม่
```bash
curl -X POST "https://your-api.com/webhook/scrobble" \
  -H "Content-Type: application/json" \
  -d '{
    "artist": "IVE",
    "title": "HEYA",
    "album": "IVE SWITCH",
    "timestamp": "2025-01-31T10:00:00Z"
  }'
```

### Preview ก่อนลบ tracks ตามช่วงวันที่
```bash
curl -X DELETE "https://your-api.com/api/tracks/range?start=2025-01-01&end=2025-01-31&dryRun=true"
```

---

**Last Updated:** 2026-05-10  
**API Version:** 1.0.2
