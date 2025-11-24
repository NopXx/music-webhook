# Music Webhook Server

เซิร์ฟเวอร์สำหรับรับข้อมูลการฟังเพลงจากหลายแหล่ง (Web Scrobbler, ListenBrainz ฯลฯ) แล้วบันทึกลง MongoDB พร้อมระบบ enrichment จาก Spotify พัฒนาโดยใช้ Express.js รันบน Bun.js

## ไฮไลต์สำคัญ
- 🎧 รับ webhook จาก Web Scrobbler และ ListenBrainz import format
- 💾 เก็บข้อมูลการฟังเพลงทั้งหมดใน MongoDB พร้อม timestamp/listened_at จริง
- 🎵 ดึงข้อมูลเสริมจาก Spotify (ปกอัลบั้ม, popularity, audio features)
- 🛡️ มีระบบ validation, rate limit, security headers และ request logging
- 📊 REST API สำหรับดูสถิติ, รายการเพลงล่าสุด, สถานะ Now Playing
- ♻️ ป้องกันข้อมูลซ้ำ, enrich ข้อมูลย้อนหลังได้ และมีเครื่องมือดูแล cache

## โครงสร้างโปรเจกต์โดยย่อ
```
.
├── index.js                # Entry point ของเซิร์ฟเวอร์
├── routes/webhook.js       # Logic ของ webhook + REST API
├── middleware/             # validation, security, debug middlewares
├── services/               # now playing state, Spotify integration
├── models/Track.js         # Mongoose schema และ helper methods
└── test-*.js               # สคริปต์ทดสอบการทำงานรูปแบบต่างๆ
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

   # กรณีต้องการใช้ Spotify enrichment
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   SPOTIFY_FETCH_AUDIO_FEATURES=false
   ```
4. ตรวจสอบว่า MongoDB ทำงานอยู่ (local หรือ remote ก็ได้)

## การใช้งาน
- โหมดพัฒนา
  ```bash
  bun run dev
  ```
- โหมด production
  ```bash
  bun run start
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

### เครื่องมือ Import แบบ UI
- เข้า URL `http://localhost:3000/import/listenbrainz`
- รองรับการวาง JSON ปกติหรือ JSON Lines, รวมถึงการอัปโหลดไฟล์ `.json` / `.jsonl`
- ใช้ parser ตัวเดียวกับ webhook เดิม จึงมีการคิว enrichment Spotify และ validation ครบ
- แสดงสรุปจำนวนที่สร้าง/อัปเดต/ข้าม พร้อมแสดง error ต่อบรรทัด

## REST API หลัก
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET    | `/api/health` | ตรวจสอบสถานะเซิร์ฟเวอร์ |
| GET    | `/api/stats?range=week`  | สถิติรวม + ตัวเลือก range/offset + Spotify |
| GET    | `/api/tracks?page=1&limit=50&search=` | รายการเพลงทั้งหมดพร้อมค้นหา/จัดเรียง |
| PATCH  | `/api/tracks` | อัปเดตสถานะ Loved ของเพลง (`{ id, isLoved }`) |
| GET    | `/api/tracks/top-artists?range=month&limit=10` | Leaderboard ศิลปินยอดนิยม |
| GET    | `/api/tracks/top-tracks?range=month&limit=15` | Leaderboard เพลงยอดนิยม |
| GET    | `/api/track?artist=<name>&title=<title>` | Analytics เพลงเดี่ยว (distribution, connectors, Spotify) |
| GET    | `/api/albums?artist=<name>&album=<album>` | สถิติอัลบัม + timeline 30 วัน |
| GET    | `/api/artists/:name` | โปรไฟล์ศิลปิน (top tracks/albums, timeline, recent) |
| GET    | `/api/nowplaying` | ดูสถานะ Now Playing ในหน่วยความจำ |
| POST   | `/api/nowplaying/playing` | ตั้ง/อัปเดตสถานะ Now Playing เอง |
| POST   | `/webhook/scrobble` | รับข้อมูล scrobble/nowplaying (ทุกฟอร์แมต) |
| POST   | `/api/import/listenbrainz` | นำเข้าข้อมูล ListenBrainz (JSON หรือ JSON Lines) แบบเป็นกลุ่ม |
| DELETE | `/api/tracks/range?start=<ISO>&end=<ISO>&dryRun=true` | ลบข้อมูลตามช่วงวันที่ (รองรับกรอง source/connector) |

> 📚 รายละเอียดพารามิเตอร์ของ endpoint ชุดสถิติ/analytics ดูเพิ่มได้ใน `docs/analytics-api.md`

### Spotify Integration
| Method | Endpoint | การใช้งาน |
|--------|----------|-----------|
| GET    | `/api/spotify/status` | ดูค่าคอนฟิก Spotify ปัจจุบัน |
| GET    | `/api/spotify/stats`  | ดูจำนวนที่ enrich สำเร็จ/รอคิว |
| POST   | `/api/spotify/enrich?limit=10&force=false` | บังคับ enrich ข้อมูลล่าสุด |
| POST   | `/api/spotify/update-missing?missingOnly=true` | เติมข้อมูลที่ยังขาด (duration, album, year ฯลฯ) |
| DELETE | `/api/spotify/cache` | ล้าง cache คำค้นหา Spotify |

### Duplicate Management
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET    | `/api/duplicates` | สำรวจข้อมูลซ้ำ |
| DELETE | `/api/duplicates?dryRun=true` | ลบหรือพรีวิวข้อมูลซ้ำ |

> หมายเหตุ: สคริปต์เหล่านี้จำเป็นต้องมีเซิร์ฟเวอร์และ MongoDB ที่พร้อมใช้งานก่อน

## สถาปัตยกรรมและ Middleware
- `validation.js` ตรวจสอบ content-type, รูปแบบข้อมูล, และสร้าง `req.validatedTrack`
- `webhook.js` รวม logic ของการ parse, บันทึก, enrich, และตอบกลับ
- `nowPlayingService.js` จัดการสถานะ Now Playing แบบ in-memory พร้อม heuristic timeout
- `Track.js` (Mongoose) ดูแล schema, dedupe logic, Spotify helper, และสถิติต่างๆ

## การตั้งค่าเพิ่มเติม
- `SCROBBLE_DEDUPE=off|window` เปิด/ปิดระบบกันข้อมูลซ้ำ (ค่า default: off)
- `DEBUG_VALIDATION=true` เปิด log การตรวจสอบข้อมูลที่เข้ามา
- `NODE_ENV=production` จะเปลี่ยน behavior ของ logging และ middleware บางตัว

## การดีพลอย
1. สร้าง image ด้วย Docker (มี `Dockerfile` ให้):
   ```bash
   docker build -t music-webhook .
   ```
2. หรือใช้ `docker-compose up -d` เพื่อรันพร้อม MongoDB/บริการอื่นๆ (ปรับไฟล์ `docker-compose.yml` ตามต้องการ)
3. ตรวจสอบ environment variables ใน container ให้ครบ โดยเฉพาะ `MONGODB_URI`

## ทิปและแนวทางปฏิบัติ
- หากใช้ Spotify ให้เปิด `SPOTIFY_FETCH_AUDIO_FEATURES=true` เฉพาะตอนต้องการข้อมูลเชิงลึก เพราะใช้ quota เพิ่ม
- สร้าง index ใน MongoDB ตามที่ schema กำหนดแล้ว เพื่อให้ query ทำงานเร็วขึ้น
- สามารถเพิ่มระบบ auth/API key เพิ่มเติมได้ที่ middleware `validateApiKey`

## การมีส่วนร่วม
ยินดีต้อนรับการปรับแต่ง เพิ่มฟีเจอร์ และแชร์สคริปต์ทดสอบใหม่ๆ  
ถ้าพบปัญหาหรือมีไอเดียใหม่สามารถเปิด issue/PR ได้ทันที

---
พัฒนาเพื่อให้การเก็บประวัติการฟังเพลงเป็นเรื่องง่าย สนุก และมีข้อมูลครบถ้วน พร้อมต่อยอดวิเคราะห์ต่อได้ทันที 🎶
