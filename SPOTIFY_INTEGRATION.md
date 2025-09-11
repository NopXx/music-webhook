# 🎵 Music Webhook - Spotify Integration Summary

## การแก้ไขที่ทำไปแล้ว

### 1. เพิ่ม Dependencies
- เพิ่ม `axios` สำหรับเรียก Spotify API

### 2. สร้าง Spotify Service (`services/spotifyService.js`)
- **SpotifyService** class สำหรับจัดการ Spotify API
- รองรับ OAuth 2.0 Client Credentials flow
- Smart search matching ด้วย fuzzy algorithm
- Search result caching เพื่อลดการเรียก API
- รองรับ audio features (เสริม)
- Rate limiting protection

### 3. อัพเดต Track Model (`models/Track.js`)
- เพิ่มฟิลด์ `spotify` สำหรับเก็บข้อมูลจาก Spotify
- เพิ่มฟิลด์ status การ enrichment
- เพิ่ม methods สำหรับจัดการข้อมูล Spotify
- เพิ่ม indexes สำหรับ performance

### 4. อัพเดต Webhook Routes (`routes/webhook.js`)
- เพิ่ม automatic Spotify enrichment เมื่อมี track ใหม่
- เพิ่ม endpoints สำหรับจัดการ Spotify integration
- อัพเดต stats API ให้รวม Spotify statistics

### 5. เพิ่ม API Endpoints ใหม่
- `GET /api/spotify/status` - ดูสถานะ integration
- `GET /api/spotify/stats` - สถิติ enrichment
- `POST /api/spotify/enrich` - enrichment ด้วยตัวเอง
- `DELETE /api/spotify/cache` - ล้าง cache

### 6. อัพเดต Configuration
- เพิ่ม environment variables สำหรับ Spotify
- อัพเดต `.env.example`
- เพิ่ม test scripts ใน `package.json`

### 7. สร้างไฟล์ทดสอบ
- `test-spotify.js` - ทดสอบ Spotify integration

### 8. อัพเดต Documentation
- อัพเดต README.md ให้ครอบคลุม Spotify integration
- เพิ่ม API examples
- เพิ่ม troubleshooting guide

## วิธีเริ่มใช้งาน

### 1. ติดตั้ง Dependencies
```bash
cd music-webhook
bun install
```

### 2. ตั้งค่า Spotify API (เสริม)
1. ไปที่ https://developer.spotify.com/dashboard
2. สร้าง App ใหม่
3. คัดลอก Client ID และ Client Secret
4. ใส่ในไฟล์ .env:
```env
SPOTIFY_CLIENT_ID=your_actual_client_id
SPOTIFY_CLIENT_SECRET=your_actual_client_secret
```

### 3. เริ่ม Server
```bash
bun run dev
```

### 4. ทดสอบ Spotify Integration
```bash
# ตรวจสอบสถานะ
curl http://localhost:3000/api/spotify/status

# ทดสอบแบบครบวงจร
bun run test:spotify
```

## การทำงานของระบบ

### 1. Automatic Enrichment
- เมื่อมี track ใหม่เข้ามาจาก webhook
- ระบบจะไปค้นหาข้อมูลจาก Spotify API อัตโนมัติ (แบบ async)
- ไม่ทำให้ response ช้า

### 2. Manual Enrichment
```bash
# Enrichment tracks ที่ยังไม่มีข้อมูล Spotify
curl -X POST "http://localhost:3000/api/spotify/enrich?limit=10"

# Force enrichment ทั้งหมด
curl -X POST "http://localhost:3000/api/spotify/enrich?limit=20&force=true"
```

### 3. Cache Management
```bash
# ดูสถิติ cache
curl http://localhost:3000/api/spotify/status

# ล้าง cache
curl -X DELETE http://localhost:3000/api/spotify/cache
```

## ข้อมูลที่เพิ่มเข้ามา

### จาก Spotify API
- **Track Info**: Spotify ID, URI, URL, popularity, preview URL
- **Artist Info**: ชื่อศิลปิน, Spotify URL
- **Album Info**: ชื่อ, release date, album art, track count
- **Audio Features** (เสริม): danceability, energy, tempo, valence

### Enrichment Status
- `spotify_enriched`: มีข้อมูล Spotify แล้ว
- `spotify_search_attempted`: เคยค้นหาแล้ว
- `spotify_match_found`: เจอข้อมูลใน Spotify

## Performance & Optimization

### Smart Caching
- Cache search results เป็นเวลา 30 นาที
- ลดการเรียก Spotify API ซ้ำ

### Rate Limiting Protection
- Delay ระหว่างการเรียก API
- Error handling สำหรับ rate limits

### Efficient Matching
- Text cleaning และ normalization
- Fuzzy matching algorithm
- Confidence scoring

## Monitoring & Statistics

### ดูสถิติ Enrichment
```bash
curl http://localhost:3000/api/spotify/stats
```

**ข้อมูลที่ได้:**
- จำนวน tracks ทั้งหมด
- จำนวนที่ enriched แล้ว
- อัตราความสำเร็จ (match rate)
- จำนวนที่รอ enrichment

### ดูสถิติรวมใน Main Stats
```bash
curl http://localhost:3000/api/stats
```

## Best Practices

### 1. Environment Configuration
```env
# สำหรับ Production
SPOTIFY_FETCH_AUDIO_FEATURES=false  # ลด API calls
SCROBBLE_DEDUPE=basic              # ป้องกัน duplicates

# สำหรับ Development
SPOTIFY_FETCH_AUDIO_FEATURES=true   # ข้อมูลครบ
DEBUG_WEBHOOKS=true                 # debug info
```

### 2. การจัดการ Cache
- Cache จะถูกล้างอัตโนมัติทุก 30 นาที
- สามารถล้างด้วยตัวเองผ่าน API
- Monitor cache size ผ่าน status endpoint

### 3. Error Handling
- ระบบจะ retry อัตโนมัติถ้าเจอ temporary errors
- Mark tracks ที่ไม่เจอใน Spotify เพื่อไม่ค้นซ้ำ
- Log ข้อผิดพลาดสำหรับ debugging

## Migration สำหรับ Tracks เดิม

หาก database มี tracks เดิมอยู่แล้ว:

```bash
# Enrich tracks เดิมทีละน้อย
curl -X POST "http://localhost:3000/api/spotify/enrich?limit=50"

# ตรวจสอบ progress
curl http://localhost:3000/api/spotify/stats

# Enrich ต่อเนื่องจนครบ
# (ทำซ้ำจนกว่า pending_enrichment = 0)
```

## การ Backup & Recovery

### ข้อมูล Spotify เก็บแยกจากข้อมูลหลัก
- หาก Spotify API มีปัญหา track หลักยังใช้งานได้
- สามารถ re-enrich ได้ทุกเมื่อ
- Cache ถูกเก็บใน memory (จะหายเมื่อ restart server)

### MongoDB Schema ใหม่
- ข้อมูลเดิมไม่เสียหาย
- เพิ่มฟิลด์ใหม่แบบ optional
- Compatible กับข้อมูลเก่า

---

## สรุป

ระบบ Spotify Integration ที่เพิ่มเข้ามาจะทำให้:

✅ **ข้อมูลสมบูรณ์ขึ้น** - album art, release date, metadata  
✅ **ค้นหาง่ายขึ้น** - มี Spotify ID สำหรับ reference  
✅ **ประสิทธิภาพดี** - caching และ smart matching  
✅ **ไม่กระทบระบบเดิม** - enrichment ทำงานแบบ async  
✅ **จัดการง่าย** - APIs สำหรับ monitoring และ control  

🎵 Happy Music Tracking! 🎵
