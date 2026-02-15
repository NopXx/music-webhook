# Analytics API Documentation

ชุด API endpoint สำหรับสำรวจและจัดการข้อมูลการฟังเพลงใน MongoDB  
ทุก endpoint รองรับ `Accept: application/json` และได้รับการคุ้มครองด้วย middleware (rate limit, logging)

---

## 📊 พารามิเตอร์ร่วม

| ชื่อ | ประเภท | คำอธิบาย |
|------|--------|-----------|
| `range` | `string` | เลือกหน้าต่างเวลา: `week` (ดีฟอลต์), `month`, `year`, `all-time` |
| `offset` | `number` | เลื่อนช่วงเวลาเป็นจำนวนหน้าต่างก่อนหน้า เช่น `offset=1` คือสัปดาห์ก่อนหน้า |
| `tz` | `string` | กำหนด timezone (เช่น `Asia/Bangkok`) สำหรับการตัดรอบวันที่ |
| `recentLimit` | `number` | จำนวนรายการล่าสุดที่ต้องการดึงมา (ใช้กับ track/album/artist analytics) |

---

## 📈 Statistics & Overview

### 1) GET `/api/stats`

**คำอธิบาย:** ดึงสถิติรวมของการฟังเพลงในช่วงเวลาที่กำหนด

**Query Parameters:**
- `range` - ช่วงเวลา (week, month, year, all-time)
- `offset` - เลื่อนช่วงเวลา (0 = ปัจจุบัน, 1 = ช่วงก่อนหน้า)
- `recentLimit` - จำนวนรายการล่าสุด (default: 10)
- `tz` - timezone

**Query:** `?range=week&offset=0&recentLimit=10`  
**Response:** สรุปรวมจำนวนเพลง/ศิลปิน/เพลย์ ระยะเวลาฟังเฉลี่ย, connector ยอดนิยม, รายการล่าสุด พร้อมสถิติ Spotify (ถ้าเปิดไว้)

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
  "spotify": { "configured": true, "enrichment_rate": 82 }
}
```

---

## 🎵 Tracks Management

### 2) GET `/api/tracks`

**คำอธิบาย:** ดึงรายการเพลงทั้งหมดพร้อม pagination, sorting และ search

**Query Parameters:**
- `page` - เลขหน้า (default: 1)
- `limit` - จำนวนต่อหน้า (default: 50, max: 100)
- `sortBy` - เรียงตาม: `scrobbledAt`, `artist`, `title` (default: `scrobbledAt`)
- `order` - ลำดับ: `asc` หรือ `desc` (default: `desc`)
- `search` - ค้นหาจากชื่อเพลง, ศิลปิน, หรืออัลบั้ม
- `range`, `offset`, `tz` - กรองตามช่วงเวลา

**ตัวอย่าง:**
```
GET /api/tracks?page=1&limit=50&sortBy=scrobbledAt&order=desc&search=IVE
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

### 3) PATCH `/api/tracks`

**คำอธิบาย:** อัปเดตสถานะ "Loved" ของเพลง

**Request Body:**
```json
{
  "id": "<trackId>",
  "isLoved": true
}
```

**Response:** คืนค่า track object ที่อัปเดตแล้ว

**ตัวอย่าง:**
```bash
curl -X PATCH https://your-api.com/api/tracks \
  -H "Content-Type: application/json" \
  -d '{"id": "507f1f77bcf86cd799439011", "isLoved": true}'
```

### 4) DELETE `/api/tracks/range`

**คำอธิบาย:** ลบเพลงทั้งหมดในช่วงวันที่ที่กำหนด

**Query Parameters:**
- `startDate` - วันเริ่มต้น (ISO 8601 format)
- `endDate` - วันสิ้นสุด (ISO 8601 format)

**ตัวอย่าง:**
```
DELETE /api/tracks/range?startDate=2025-01-01&endDate=2025-01-07
```

**Response:**
```json
{
  "success": true,
  "deletedCount": 150,
  "dateRange": {
    "start": "2025-01-01T00:00:00.000Z",
    "end": "2025-01-07T23:59:59.999Z"
  }
}
```

---

## 🏆 Leaderboards & Rankings

### 5) GET `/api/tracks/top-artists`

**คำอธิบาย:** ดึงรายการศิลปินยอดนิยมพร้อม metadata และรูปภาพ

**Query Parameters:**
- `range`, `offset`, `tz` - กรองตามช่วงเวลา
- `limit` - จำนวนศิลปิน (default: 20, max: 100)

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

### 6) GET `/api/tracks/top-tracks`

**คำอธิบาย:** จัดอันดับเพลงยอดนิยมพร้อม metadata (track art/animation)

**Query Parameters:**
- `range`, `offset`, `tz` - กรองตามช่วงเวลา
- `limit` - จำนวนเพลง (default: 20, max: 100)

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

## 🔍 Detailed Analytics

### 7) GET `/api/track`

**คำอธิบาย:** วิเคราะห์เชิงลึกสำหรับเพลงเดียว

**Query Parameters (Required):**
- `artist` - ชื่อศิลปิน
- `title` - ชื่อเพลง

**Query Parameters (Optional):**
- `recentLimit` - จำนวน scrobbles ล่าสุดที่จะดึง (default: 20)
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

### 8) GET `/api/albums`

**คำอธิบาย:** วิเคราะห์ข้อมูลอัลบั้มเฉพาะ

**Query Parameters (Required):**
- `artist` - ชื่อศิลปิน
- `album` - ชื่ออัลบั้ม

**Query Parameters (Optional):**
- `recentLimit` - จำนวน scrobbles ล่าสุด
- `tz` - timezone

**ข้อมูลที่ได้รับ:**
- Summary: จำนวนครั้งที่เล่น, first/last play, average duration
- Track List: รายชื่อเพลงในอัลบั้มพร้อมจำนวนครั้งและความยาวเฉลี่ย
- Connector Breakdown: แยกตาม connector
- Timeline: กราฟรายวันช่วง 30 วันย้อนหลัง
- Recent Scrobbles: รายการล่าสุด
- Album Art: ภาพปกล่าสุด

### 9) GET `/api/artists/:name`

**คำอธิบาย:** โปรไฟล์ศิลปินแบบละเอียด

**Path Parameter:**
- `name` - ชื่อศิลปิน (URI encoded)

**Query Parameters:**
- `tz` - timezone
- `limit` - จำนวน top tracks/albums (default: 10)
- `recentLimit` - จำนวน scrobbles ล่าสุด (default: 20)

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

---

## 🎧 Now Playing

### 10) GET `/api/nowplaying`

**คำอธิบาย:** ดึงข้อมูลสถานะกำลังเล่นปัจจุบัน (in-memory)

**Response:**
```json
{
  "isPlaying": true,
  "track": {
    "artist": "IVE",
    "title": "HEYA",
    "album": "IVE SWITCH",
    "trackArtUrl": "https://...",
    "trackAnimationUrl": "https://...",
    "duration": 180
  },
  "playback": {
    "startedAt": "2025-01-31T10:00:00.000Z",
    "currentPosition": 45,
    "connector": "youtube"
  }
}
```

**Use Case:** สำหรับแสดงผล "Now Playing" widget แบบ real-time

### 11) POST `/api/nowplaying/playing`

**คำอธิบาย:** อัปเดตสถานะกำลังเล่นปัจจุบัน (manual refresh)

**Request Body:**
```json
{
  "artist": "IVE",
  "title": "HEYA",
  "album": "IVE SWITCH",
  "currentPosition": 45,
  "duration": 180,
  "isPlaying": true,
  "connector": "youtube"
}
```

**Headers:**
```
Content-Type: application/json
```

**Response:** คืนค่า updated now playing status

---

## 📥 Import & Migration

### 12) GET `/import/listenbrainz`

**คำอธิบาย:** หน้าเว็บ UI สำหรับนำเข้าข้อมูลจาก ListenBrainz

**Response:** HTML page พร้อมฟอร์มอัพโหลด

### 13) POST `/api/import/listenbrainz`

**คำอธิบาย:** นำเข้าข้อมูล scrobbles จาก ListenBrainz export

**Request Body:**
- `Content-Type: multipart/form-data`
- Field: `file` - JSON file จาก ListenBrainz export

**หรือ:**
- `Content-Type: application/json`
- Body: Array ของ ListenBrainz format entries

**Response:**
```json
{
  "success": true,
  "imported": 1500,
  "skipped": 10,
  "errors": [],
  "summary": {
    "totalProcessed": 1510,
    "duplicates": 10,
    "newTracks": 1500
  }
}
```

**ตัวอย่าง:**
```bash
curl -X POST https://your-api.com/api/import/listenbrainz \
  -F "file=@listenbrainz-export.json"
```

---

## 🔄 Duplicates Management

### 14) GET `/api/duplicates`

**คำอธิบาย:** ดึงสถิติและรายการเพลงที่ซ้ำกัน

**Query Parameters:**
- `limit` - จำนวนรายการ duplicate groups (default: 50)
- `threshold` - เวลาที่ใกล้กันถือว่าซ้ำ (วินาที, default: 300)

**Response:**
```json
{
  "totalDuplicates": 45,
  "duplicateGroups": [
    {
      "artist": "IVE",
      "title": "HEYA",
      "instances": [
        {
          "_id": "...",
          "scrobbledAt": "2025-01-31T10:00:00.000Z",
          "connector": "youtube"
        },
        {
          "_id": "...",
          "scrobbledAt": "2025-01-31T10:02:00.000Z",
          "connector": "spotify"
        }
      ],
      "count": 2
    }
  ]
}
```

### 15) DELETE `/api/duplicates`

**คำอธิบาย:** ลบเพลงที่ซ้ำกัน (เก็บเฉพาะรายการแรก)

**Query Parameters:**
- `threshold` - เวลาที่ใกล้กันถือว่าซ้ำ (วินาที, default: 300)
- `dryRun` - ทดสอบโดยไม่ลบจริง (true/false)

**Response:**
```json
{
  "success": true,
  "duplicatesFound": 45,
  "duplicatesRemoved": 45,
  "duplicateGroups": [...],
  "message": "Successfully removed 45 duplicate tracks"
}
```

---

## 🎼 Spotify Integration

### 16) GET `/api/spotify/status`

**คำอธิบาย:** ตรวจสอบสถานะการเชื่อมต่อ Spotify

**Response:**
```json
{
  "configured": true,
  "hasCredentials": true,
  "clientIdSet": true,
  "clientSecretSet": true,
  "tokenStatus": "valid",
  "lastRefreshed": "2025-01-31T09:00:00.000Z"
}
```

### 17) GET `/api/spotify/stats`

**คำอธิบาย:** สถิติการ enrich ข้อมูลจาก Spotify

**Response:**
```json
{
  "total": 5000,
  "enriched": 4100,
  "notEnriched": 900,
  "enrichmentRate": 82,
  "lastEnrichment": "2025-01-31T08:00:00.000Z",
  "breakdown": {
    "hasSpotifyId": 4100,
    "hasAlbumArt": 4050,
    "hasPreviewUrl": 3800
  }
}
```

### 18) POST `/api/spotify/enrich`

**คำอธิบาย:** Enrich เพลงทั้งหมดด้วยข้อมูล Spotify

**Query Parameters:**
- `limit` - จำนวนเพลงที่จะ enrich (default: 100)
- `batchSize` - ขนาด batch (default: 50)

**Response:**
```json
{
  "success": true,
  "processed": 100,
  "enriched": 92,
  "failed": 8,
  "progress": {
    "total": 5000,
    "completed": 4192
  }
}
```

### 19) POST `/api/spotify/update-missing`

**คำอธิบาย:** อัปเดตข้อมูล Spotify ที่ขาดหายไปในเพลงที่มีอยู่

**Query Parameters:**
- `limit` - จำนวนเพลงที่จะอัปเดต
- `force` - บังคับอัปเดตแม้มีข้อมูลอยู่แล้ว (true/false)

**Response:**
```json
{
  "success": true,
  "totalProcessed": 150,
  "updated": 145,
  "skipped": 5,
  "errors": []
}
```

### 20) DELETE `/api/spotify/cache`

**คำอธิบาย:** ล้าง cache ของ Spotify service

**Response:**
```json
{
  "success": true,
  "message": "Spotify cache cleared successfully"
}
```

---

## ⚕️ Health & System

### 21) GET `/health` หรือ `/api/health`

**คำอธิบาย:** ตรวจสอบสถานะระบบ

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-31T10:00:00.000Z",
  "uptime": 86400,
  "database": {
    "connected": true,
    "responseTime": 15
  },
  "memory": {
    "used": 256,
    "total": 512
  }
}
```

---

## 🌐 Webhook Endpoints

### 22) POST `/webhook/scrobble`

**คำอธิบาย:** รับข้อมูล scrobble จาก external services

**Request Body:** รองรับหลายรูปแบบ
- Web Scrobbler format
- ListenBrainz format
- Custom format

**Headers:**
```
Content-Type: application/json
User-Agent: <connector-name>
```

**Response:**
```json
{
  "success": true,
  "message": "Scrobble recorded successfully",
  "track": {
    "_id": "...",
    "artist": "IVE",
    "title": "HEYA"
  }
}
```

### 23) POST `/webhook`

**คำอธิบาย:** Generic webhook endpoint (alias ของ `/webhook/scrobble`)

---

## 📝 Notes

> **Rate Limiting:** ทุก endpoint มี rate limit ป้องกันการใช้งานมากเกินไป
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

## 🚀 Quick Start Examples

### ดึงสถิติสัปดาห์นี้
```bash
curl "https://your-api.com/api/stats?range=week"
```

### ค้นหาเพลงของ IVE
```bash
curl "https://your-api.com/api/tracks?search=IVE&limit=20"
```

### ดูข้อมูลเพลงเฉพาะ
```bash
curl "https://your-api.com/api/track?artist=IVE&title=HEYA"
```

### ดู Top Artists เดือนนี้
```bash
curl "https://your-api.com/api/tracks/top-artists?range=month&limit=10"
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

---

**Last Updated:** 2025-11-27  
**API Version:** 1.0
