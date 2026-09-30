# FFVN.TGM — Private 4K Video API

## Chức năng
- API Key riêng.
- Upload video.
- Upscale thành 3840×2160.
- Lanczos + Unsharp để tăng độ nét.
- H.264 CRF 18.
- AAC 192 kbps.
- Theo dõi tiến trình.
- Tự xóa file cũ theo TTL.
- Giao diện mobile/desktop.
- Toàn bộ giao diện ưu tiên font GFF-LATIN-BOLD.

## 1. Cài đặt
Yêu cầu Node.js 22+.

```bash
npm install
```

Tạo `.env` từ `.env.example` và đổi API_KEY thành một chuỗi dài, ngẫu nhiên.

## 2. Chạy
```bash
npm start
```

Mở:
http://localhost:3000

## 3. Đặt font
Đặt file font hợp lệ mà bạn có quyền sử dụng vào:

`public/fonts/GFFLatinW05-Bold.woff2`

Tên file phải đúng như trên để giao diện tự nhận font.

## 4. API

### Health
`GET /api/health`

### Upload + xử lý
`POST /api/enhance`

Header:
`x-api-key: API_KEY_CUA_BAN`

Form-data:
`video: <video file>`

Ví dụ curl:

```bash
curl -X POST http://localhost:3000/api/enhance \
  -H "x-api-key: API_KEY_CUA_BAN" \
  -F "video=@video.mp4"
```

API trả về `id` và `statusUrl`.

### Kiểm tra
`GET /api/status/:id`

Header:
`x-api-key: API_KEY_CUA_BAN`

### Tải file
`GET /api/download/:id`

Header:
`x-api-key: API_KEY_CUA_BAN`

## 5. Docker

```bash
docker compose up -d --build
```

## Quan trọng
Đây là upscale 4K bằng FFmpeg, không phải AI super-resolution. Nó tăng độ phân giải và độ nét nhưng không thể tạo lại chi tiết gốc đã mất.

Không commit `.env` hoặc API_KEY lên Git.
