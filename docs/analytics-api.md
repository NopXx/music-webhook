# Analytics API Cheatsheet

ชุด endpoint ใหม่สำหรับสำรวจข้อมูลการฟังเพลงใน MongoDB โดยตรง  
ทุกรายการรองรับ `Accept: application/json` และยังได้รับการคุ้มครองด้วย middleware เดิม (rate limit, logging)

## พารามิเตอร์ร่วม

| ชื่อ | คำอธิบาย |
|------|-----------|
| `range` | เลือกหน้าต่างเวลา `week` (ดีฟอลต์), `month`, `year`, `all-time` |
| `offset` | เลื่อนช่วงเวลาเป็นจำนวนหน้าต่างก่อนหน้า เช่น `offset=1` คือสัปดาห์ก่อนหน้า |
| `tz` | กำหนด timezone สำหรับการตัดรอบ (เช่น `Asia/Bangkok`) |
| `recentLimit` | จำนวนรายการล่าสุดที่ต้องการ (ฝั่ง track/album/artist analytics) |

## 1) GET `/api/stats`

**Query:** `?range=week&offset=0&recentLimit=10`  
**Response:** สรุปรวมจำนวนเพลง/ศิลปิน/เพลย์ ระยะเวลาฟังเฉลี่ย, connector ยอดนิยม, รายการล่าสุด พร้อมสถิติ Spotify (ถ้าเปิดไว้)

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

## 2) GET `/api/tracks`

**Query:** `?page=1&limit=50&sortBy=scrobbledAt&order=desc&search=IVE`  
**Response:** รายการเพลงทั้งหมดพร้อม pagination, meta การจัดเรียง, ตัวกรองที่ใช้ รวมถึงข้อมูลช่วงเวลา (range window)

## 3) PATCH `/api/tracks`

อัปเดตสถานะ Loved ทีละรายการ

```http
PATCH /api/tracks
Content-Type: application/json

{ "id": "<trackId>", "isLoved": true }
```

คืนค่ารายการ track ที่เพิ่งอัปเดต

## 4) GET `/api/tracks/top-artists`

- `range` + `offset` เลือกช่วงเวลาได้เหมือน `/api/stats`
- `limit` กำหนดจำนวนศิลปิน (สูงสุด 100)

```json
{
  "window": { "range": "month", "start": "...", "end": "..." },
  "items": [
    {
      "artist": "NewJeans",
      "plays": 58,
      "latestTrack": {
        "title": "How Sweet",
        "album": "How Sweet",
        "scrobbledAt": "2025-01-07T08:15:00.000Z",
        "trackArtUrl": "https://..."
      },
      "artistImage": "https://..."
    }
  ]
}
```

## 5) GET `/api/tracks/top-tracks`

จัดอันดับเพลงยอดนิยมพร้อม metadata ล่าสุด (track art/animation)  
รองรับ `range`, `offset`, `limit` เช่นเดียวกับ top artists

## 6) GET `/api/track`

**จำเป็น:** `artist`, `title`  
**เลือกได้:** `recentLimit`, `tz`

ตอบกลับรวม:

- ตัวเลขสรุป (จำนวน scrobble, loved count, first/last play, average duration)
- การกระจายเวลา: รายชั่วโมง (0-23), รายวัน (ISO 1-7), รายเดือน (`YYYY-MM`)
- Connector / source / user-agent breakdown
- รายการ scrobble ล่าสุด
- Spotify metadata (ถ้ามี)
- คำแนะนำเพลงอื่นของศิลปินเดียวกัน (`relatedTracks`)

## 7) GET `/api/albums`

**จำเป็น:** `artist`, `album`  
**เลือกได้:** `recentLimit`, `tz`

ให้ข้อมูล:

- จำนวนครั้งที่เล่น, เวลาเล่นครั้งแรก/ล่าสุด, ระยะเวลาฟังเฉลี่ย
- รายชื่อเพลงในอัลบั้มพร้อมจำนวนครั้งและความยาวเฉลี่ย
- Connector ยอดนิยมของอัลบั้ม
- Timeline รายวันช่วง 30 วันย้อนหลัง
- รายการ scrobble ล่าสุดและภาพปกล่าสุดที่หาได้

## 8) GET `/api/artists/:name`

`name` เป็น path parameter (URI encoded), รองรับ `tz`, `limit`, `recentLimit`  
ข้อมูลที่ส่งกลับ:

- สรุป plays + จำนวนเพลง/อัลบัมที่ไม่ซ้ำ
- Top tracks & top albums ของศิลปินนั้น
- Connector breakdown
- Timeline 30 วันย้อนหลัง
- รายการ scrobble ล่าสุด
- รูปศิลปิน (พยายามดึงจาก Last.fm ถ้ามี API Key ไม่เช่นนั้น fallback เป็น avatar)

---

> หมายเหตุ: ทุก endpoint ยังคงเคารพ rate limit เดิมของระบบ หากต้องการป้องกันเพิ่มเติมสามารถต่อยอดด้วย API key middleware (`validateApiKey`)

