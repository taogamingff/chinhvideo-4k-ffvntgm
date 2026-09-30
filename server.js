import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || "";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const FILE_TTL_MINUTES = Number(process.env.FILE_TTL_MINUTES || 60);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

if (!API_KEY || API_KEY.includes("CHANGE_THIS")) {
  console.warn("WARNING: Set a strong API_KEY in .env before exposing this server.");
}

const uploadDir = path.join(__dirname, "storage", "uploads");
const outputDir = path.join(__dirname, "storage", "outputs");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const ok = /^video\\//i.test(file.mimetype);
    cb(ok ? null : new Error("Chỉ chấp nhận file video."), ok);
  }
});

const jobs = new Map();

function authorized(req) {
  const supplied =
    req.get("x-api-key") ||
    (req.get("authorization") || "").replace(/^Bearer\\s+/i, "");
  return Boolean(API_KEY && supplied && crypto.timingSafeEqual(
    Buffer.from(supplied),
    Buffer.from(API_KEY)
  ));
}

function auth(req, res, next) {
  if (!authorized(req)) {
    return res.status(401).json({
      ok: false,
      error: "API_KEY_INVALID"
    });
  }
  next();
}

function safeUnlink(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function cleanupOldFiles() {
  const now = Date.now();
  for (const dir of [uploadDir, outputDir]) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      try {
        const age = now - fs.statSync(file).mtimeMs;
        if (age > FILE_TTL_MINUTES * 60_000) fs.unlinkSync(file);
      } catch {}
    }
  }
}

setInterval(cleanupOldFiles, 5 * 60_000).unref();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "FFVN.TGM 4K Video API",
    ffmpeg: Boolean(ffmpegPath),
    maxUploadMB: MAX_UPLOAD_MB
  });
});

app.post("/api/enhance", auth, upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "VIDEO_REQUIRED" });
  }

  const id = crypto.randomUUID();
  const input = req.file.path;
  const ext = ".mp4";
  const output = path.join(outputDir, `${id}${ext}`);

  const job = {
    id,
    status: "processing",
    progress: 0,
    input,
    output,
    createdAt: Date.now(),
    error: null
  };
  jobs.set(id, job);

  /*
    4K enhancement:
    - Force output to 3840x2160.
    - Lanczos scaling preserves detail better than a basic scale.
    - Unsharp adds controlled crispness.
    - H.264 CRF 18 gives high quality.
    - Audio is copied when possible.
    - If the source is vertical, it is fitted into 4K with black bars.
  */
  const vf =
    "scale=3840:2160:force_original_aspect_ratio=decrease:flags=lanczos," +
    "pad=3840:2160:(ow-iw)/2:(oh-ih)/2," +
    "unsharp=5:5:0.75:5:5:0";

  const args = [
    "-hide_banner",
    "-y",
    "-i", input,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-c:a", "aac",
    "-b:a", "192k",
    "-progress", "pipe:1",
    "-nostats",
    output
  ];

  const ff = spawn(ffmpegPath, args, { windowsHide: true });

  let durationSeconds = 0;

  // Probe duration using a second lightweight ffprobe is not guaranteed by
  // ffmpeg-static, so progress is estimated from FFmpeg's out_time_ms.
  ff.stdout.on("data", chunk => {
    const text = chunk.toString();
    const match = text.match(/out_time_ms=(\\d+)/);
    if (match) {
      const ms = Number(match[1]);
      if (durationSeconds > 0) {
        job.progress = Math.min(99, Math.round((ms / 1_000_000 / durationSeconds) * 100));
      }
    }
    const speedMatch = text.match(/speed=([^\\s]+)/);
    if (speedMatch) job.speed = speedMatch[1];
  });

  let stderr = "";
  ff.stderr.on("data", chunk => {
    stderr += chunk.toString();
    // FFmpeg prints Duration in stderr.
    if (!durationSeconds) {
      const m = stderr.match(/Duration:\\s+(\\d+):(\\d+):(\\d+(?:\\.\\d+)?)/);
      if (m) {
        durationSeconds =
          Number(m[1]) * 3600 +
          Number(m[2]) * 60 +
          Number(m[3]);
      }
    }
  });

  ff.on("error", err => {
    job.status = "failed";
    job.error = err.message;
    safeUnlink(input);
  });

  ff.on("close", code => {
    safeUnlink(input);

    if (code === 0 && fs.existsSync(output)) {
      job.status = "completed";
      job.progress = 100;
      job.url = `${PUBLIC_BASE_URL || `http://localhost:${PORT}`}/api/download/${id}`;
    } else {
      job.status = "failed";
      job.error = "FFmpeg failed";
      safeUnlink(output);
    }
  });

  res.status(202).json({
    ok: true,
    id,
    status: job.status,
    progress: job.progress,
    statusUrl: `${PUBLIC_BASE_URL || `http://localhost:${PORT}`}/api/status/${id}`
  });
});

app.get("/api/status/:id", auth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });
  }

  const result = {
    ok: true,
    id: job.id,
    status: job.status,
    progress: job.progress,
    speed: job.speed || null,
    error: job.error
  };

  if (job.status === "completed") result.downloadUrl = job.url;
  res.json(result);
});

app.get("/api/download/:id", auth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "completed" || !fs.existsSync(job.output)) {
    return res.status(404).json({ ok: false, error: "OUTPUT_NOT_FOUND" });
  }

  res.download(job.output, `FFVN-TGM-4K-${job.id}.mp4`);
});

app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      ok: false,
      error: `VIDEO_TOO_LARGE_MAX_${MAX_UPLOAD_MB}MB`
    });
  }
  res.status(400).json({
    ok: false,
    error: err?.message || "BAD_REQUEST"
  });
});

app.listen(PORT, () => {
  console.log(`FFVN.TGM 4K Video API running on port ${PORT}`);
});