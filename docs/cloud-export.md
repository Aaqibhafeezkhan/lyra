# Lyra Cloud Export: render lyric videos on a server

Status: design (nothing built yet). Owner: Dhruv. Written 2026-10-21. Replaces the short cloud notes in issue #25. Related: [windows-export-quality.md](windows-export-quality.md) (the quality bar), [android-export-quality.md](android-export-quality.md) (the on-phone plan this makes mostly unnecessary).

Goal: a phone (or PC, or a web page) sends **a song's sound, its lyrics and a few options**, and gets back a **1080x1920, 60 fps MP4 that looks exactly like the Windows export**, with clean, normalized sound. Free to use, open source, self-hostable.

---

## 1. The honest part first: what the server can and cannot have

A server only has what it is given. Two sources people expect are **not available to a public cloud service**, and the design is built around that instead of hoping:

| Wanted | Why not | What the design does instead |
|---|---|---|
| Spotify's audio | Encrypted and licensed; no API gives the stream to anyone | Sound comes from **the user's own audio file**, or from **a recording the phone made** (microphone, cleaned up on the server) |
| The YouTube music video as background | Downloading YouTube streams breaks YouTube's terms; hosted servers are also blocked by YouTube's bot checks | Backgrounds are things **the user's device already has and uploads**: cover art, a drawn motion style, the Apple preview clip the app already plays, or the user's own video/photo |

**The rule that keeps the service legal and simple: the server never contacts YouTube, Spotify or Apple. It only processes files the user uploads**, like any online video editor. The user is responsible for having the right to the audio they upload (terms say so).

For people who want more on their own machine, a self-hosted instance may add their own tools; the project does not ship or support downloading from YouTube/Spotify and the hosted instance never will.

What cloud export **does** solve:
- Android and any phone: no on-phone render engine, no screen filming, identical look to Windows, steady 60 fps, exact 9:16, clean mastered sound (server-side noise reduction and loudness for microphone takes).
- Slow PCs: heavy or long exports move off the device.
- Sharing: the result is a link as well as a file.

What it does **not** solve: getting Spotify's real sound. That stays "own file" or "microphone".

## 2. Requirements

Functional
- F1. Create a render job from: audio (file or phone recording), lyrics with timing, cover image, title/artist, look options (style, font, highlight, position, ratio, fps, quality), optional background media, the chosen part (start/end).
- F2. Show progress and an estimate; deliver an MP4 (and cover JPEG) by link and by download.
- F3. Same scene code as the apps (no second implementation of the look).
- F4. Works from Android, Windows and a plain web page.
- F5. Self-hostable with one command.

Non-functional
- N1. **Quality**: constant frame rate, loudness -14 LUFS +/- 1, peak under -1 dBFS, `moov` at the front (fast start), same analyzer gates as Windows.
- N2. **Speed**: a 60 s reel in under 3 minutes end to end at 1080p60; a 3-minute song under 8 minutes.
- N3. **Cost**: free for users; hosting cost small enough to run on free tiers or about $5-20 a month.
- N4. **Privacy**: no accounts, files deleted after 24 hours or on request, no logging of content.
- N5. **Abuse-resistant**: rate limits, size and length caps, sandboxed rendering.
- N6. **Open source**: no proprietary service lock-in; the same container runs anywhere.

Constraints: solo maintainer, Vercel already hosts the website, TypeScript everywhere, scene code is TypeScript with a 2D canvas.

## 3. High-level design

```
 App / web page                      Vercel (website project)                          Render worker (container)
 ---------------                     -------------------------                         --------------------------
 1 POST /api/v1/jobs  ------------>  create job, return jobId + upload tokens
 2 upload files direct to Blob ---->  Vercel Blob (audio, cover, bg, lyrics.json)
 3 POST /jobs/{id}/start  -------->  check limits -> state=queued -> trigger worker --->  starts with JOB_ID
 4 GET /jobs/{id}  (poll 2 s)  <---  state + progress + eta  <--- progress updates ---   download inputs from Blob
                                                                                         master audio (ffmpeg)
                                                                                         render frames in N parallel segments
                                                                                         encode segments, concat, mux audio
 5 GET result URL  <--------------   signed link (24 h)          <--- upload result ---   upload MP4 + cover to Blob, state=done
 6 DELETE /jobs/{id} (optional) or auto-delete after 24 h (cron)
```

Components
- **Website project (Vercel, exists):** static site plus `/api/v1/*` serverless routes (TypeScript). Holds no heavy work.
- **Storage: Vercel Blob** for uploads and results (free tier covers early use; swappable for S3/MinIO via one small interface).
- **Job store + queue:** a small Postgres table (Neon free tier) or Upstash Redis; the API is the only writer except for progress updates by the worker.
- **Render worker:** one container image (Node + `skia-canvas` + ffmpeg + bundled fonts), started per job on a scale-to-zero service (Google Cloud Run Jobs, or Fly Machines, or a $5 VPS with a worker loop). It reads the job, renders, uploads, exits.
- **Shared scene package:** `scene.ts` and its helpers move to `packages/scene`, used by the apps and the worker, with golden-frame tests so the look cannot drift.
- **Clients:** a small TypeScript SDK (`@lyra/cloud-client`) used by the Windows and Android shells and the web page.

## 4. The render worker in detail

Why not headless Chrome? Capturing 10,000 screenshots is slow (minutes per minute of video) and Chromium builds without H.264 are common in containers. Why not Vercel functions? No GPU, short time limits, small memory, no long-running ffmpeg. So: **Node + `skia-canvas` (Skia 2D canvas without a browser) + ffmpeg**.

Pipeline for a job:
1. **Fetch inputs** from Blob (size/type validated with `ffprobe`; ffmpeg runs with `-protocol_whitelist file` so inputs cannot make it fetch URLs).
2. **Master the audio:** convert to 48 kHz stereo; for microphone takes: high-pass 60 Hz, noise reduction (RNNoise or `afftdn`), light gate; then two-pass `loudnorm` to -14 LUFS, true-peak limiter -1 dBTP, 80 ms fade in, 300 ms fade out; encode AAC-LC 192 kbps.
3. **Plan frames:** `frames = round(seconds * fps)`; split into N time segments (N = vCPUs, each starting on a key frame boundary).
4. **Render each segment in a worker thread:** the shared scene draws frame `n` at time `n/fps` onto a `skia-canvas`; raw frames are piped to an `ffmpeg` process (libx264, High profile, `-preset veryfast`, `-crf 18` or a bitrate cap, constant frame rate) writing a segment file. Background media (user video) is pre-extracted by ffmpeg to a frame sequence at the output rate; stills use Ken-Burns motion computed in the scene.
5. **Join:** ffmpeg concat of segments (stream copy), mux the mastered audio, end card appended as its own segment, `-movflags +faststart`.
6. **Cover JPEG** from a frame at 33% of the part.
7. **Upload** results; update state; delete local files.

Speed estimate (a typical reel, 60 s, 1080p60, 4 vCPUs): scene draw about 25 ms per frame (3,600 frames, 90 CPU-s), x264 veryfast about 40 CPU-s, audio mastering 10 CPU-s, so about 140 CPU-s: **under 45 s of wall time on 4 vCPUs**, plus upload and download. A 3-minute song is about 3x that. These numbers must be measured in spike C0.

Fonts: Inter plus Noto Sans for Devanagari, Gurmukhi, Gujarati, Bengali, Tamil, Telugu, Arabic and CJK are bundled in the image (the apps already show lyrics in these scripts).

## 5. API (v1)

All JSON over HTTPS; the job id is a 128-bit random secret in the URL (no accounts).

| Call | Purpose |
|---|---|
| `POST /api/v1/jobs` body `{ audio:{kind:'file'\|'mic', durationMs}, lyrics:[{timeMs,text,words?}], title, artist, ratio, fps, quality, look, part:{startMs,endMs}, background:{kind:'cover'\|'motion'\|'media', style?} }` | Validate, create the job, return `{ jobId, uploads:[{name, url, token}], expiresAt }` (client uploads straight to Blob) |
| `POST /api/v1/jobs/{id}/start` | Check that the required files exist and limits hold, enqueue, trigger the worker |
| `GET /api/v1/jobs/{id}` | `{ state: 'created'\|'queued'\|'rendering'\|'done'\|'failed'\|'expired', progress: 0-1, etaSec, result?:{videoUrl, coverUrl, bytes}, error?:{code, message} }` |
| `DELETE /api/v1/jobs/{id}` | Delete the job and all its files now |
| `GET /api/v1/limits` | Current caps (max part length, max upload, daily jobs left for this client) |
| `GET /api/health` | Queue length, oldest job age (used by monitoring) |

Internal: `POST /api/internal/jobs/{id}/progress` and `/done` (HMAC-signed by the worker).

## 6. Data model

```
Job  { id, state, createdAt, expiresAt, attempts, clientHash, request(json),
       files{ audio, cover, background, lyrics, video, coverOut }, progress, etaSec, error{code,message},
       stats{ renderMs, frames, bytes } }
```
- `clientHash`: salted hash of IP + app version, rotated daily; used only for rate limits.
- Rows and files expire after **24 h** (cron deletes both); `DELETE` removes them immediately.
- No lyrics, titles or audio in logs; logs hold ids, states, durations and error codes.

## 7. Limits, abuse and safety

| Risk | Control |
|---|---|
| Free compute abused | 3 jobs per client per day on the hosted instance (more on self-host), max part 60 s (hosted) / 5 min (self-host), max upload 150 MB, one running job per client; optional Cloudflare Turnstile on `start` if abuse appears |
| Malicious media | Strict type checks with `ffprobe`, size and duration caps, ffmpeg `-protocol_whitelist file`, hard time and memory limits per job, container without outbound network except the storage/DB endpoints, non-root user, read-only root filesystem |
| Copyright | Terms: you upload only audio you may use; takedown contact; files vanish in 24 h; the service never fetches third-party media itself |
| Privacy | No accounts or emails; links are secrets; deletion on request; storage encrypted at rest |
| Cost blow-up | Daily global job cap with a clear "busy, try later" message; alert on spend |
| Result link sharing | Signed URL valid 24 h; no public listing of jobs |

## 8. Scale, cost and reliability

Load: a free open-source app, early usage in the tens to a few hundred jobs a day. Worst case a viral day: queue grows; users see an honest wait estimate.

Cost (Cloud Run Jobs example, 4 vCPU / 8 GB, about $0.000024 per vCPU-second): a 60 s reel is about 140 vCPU-s, about **$0.003 a video**. The monthly free tier (about 180,000 vCPU-s) covers roughly **1,200 reels a month for nothing**; 10,000 reels a month would be about $30. Blob storage with 24 h retention is negligible. Everything else (Vercel hobby, Neon free) fits free tiers early on.

Reliability:
- Jobs are idempotent by id; segments render independently, so a failed segment retries alone (3 attempts, then `failed` with a human-readable reason).
- The worker writes progress every 2 s; if no update for 60 s the API marks the job `stalled` and re-queues once.
- If the worker platform is down, jobs stay `queued` and the UI says so; the self-host mode is the escape hatch.
- Monitoring: `/api/health`, alert when the oldest queued job is over 10 minutes, error rate over 10% in an hour, or daily spend over a cap.

## 9. Client integration

- **Android:** the dialog records or picks the sound (own file, or microphone take), shows a level check, uploads, shows progress, downloads to Movies/Lyra and opens the share sheet. No render engine, no screen capture. A background service (WorkManager, with a network constraint) finishes upload/download if the user leaves the app.
- **Windows:** unchanged by default (it already renders locally and smoothly); adds "Render in the cloud" for very long exports or weak PCs, using the same dialog.
- **Web page** (`/make`): drop an audio file, paste or fetch lyrics, pick a look, render. Gives the project a shareable demo and a way to try Lyra without installing.
- The SDK handles chunked uploads with retry, polling with backoff, and cancel.

## 10. Self-hosting

`docker compose up` runs: the API (Node), the worker (same image), local-disk storage (or MinIO), SQLite or Postgres. One `.env` sets limits. Same code path as the hosted instance, so it is also how we test. An advanced operator may add their own tools for their own use; the project does not support or document downloading from third-party services.

## 11. Trade-offs

| Decision | Gain | Cost |
|---|---|---|
| Server only handles user-uploaded files | Legal, simple, no bot-blocking, small attack surface | No Spotify audio, no YouTube background in the cloud |
| `skia-canvas` + ffmpeg instead of headless Chrome | Fast, small, deterministic, runs anywhere | Must keep the scene free of browser-only APIs; fonts and a few canvas effects need checking |
| Shared scene package | Look parity across Windows, Android, cloud | Refactor work; golden-frame tests to maintain |
| Scale-to-zero worker | Near-zero cost when idle | Cold start of a few seconds |
| Vercel for API only | Reuses what exists | Needs a second platform for the worker |
| 24 h retention, no accounts | Privacy, no user database, tiny abuse surface | No history; a lost link is lost |
| Microphone cleanup on the server | Better than on-phone processing | Still acoustic: headphones give silence |
| Hosted 60 s cap | Keeps cost and abuse low | Long songs need self-host or a local render |

## 12. Test plan

- **Look parity:** golden frames from the shared scene rendered in the app and in the worker for a fixed input (long/short lyrics, Hindi/Punjabi, bright/dark cover); pixel difference under a threshold.
- **Quality gates:** run `scripts/analyze-video.js` on every worker output in CI (60 fps constant, no gap over 1.5x, -14 LUFS +/- 1, peak under -1 dB, faststart present).
- **Audio:** a test set (clean music file, quiet mic take, noisy mic take) with expected loudness/noise-floor results.
- **Robustness:** malformed audio, huge files, wrong types, zero-length parts, lyrics with 10,000 lines, cancelled and expired jobs, worker killed mid-render.
- **Load:** 20 simultaneous jobs on the staging worker; queue and cost behave.
- **Security review:** upload handling, signed links, SSRF, resource limits, dependency audit.

## 13. Rollout

| Phase | Content | Exit gate |
|---|---|---|
| **C0 Spikes** (2-3 days) | `skia-canvas` renders the shared scene with correct fonts (Hindi/Punjabi) and matches the app frame; ffmpeg segment-parallel encode + concat; mastering chain on a mic recording; trigger a Cloud Run Job from a Vercel function; measure frames/s and cost | Numbers support the estimates in 4 and 8, or the design changes |
| **C1 Worker + CLI** (4-5 days) | `packages/scene`, the `lyra-render job.json` command (also the base for self-host), mastering, segments, faststart, golden tests | CLI output passes the analyzer gates |
| **C2 API + storage + queue** (3-4 days) | Vercel routes, Blob uploads, job table, trigger, progress, cleanup cron, limits | End-to-end render of a job from `curl` |
| **C3 Android client** (4-5 days) | Dialog, sound check + mic recording or file pick, upload service, progress, download, share; old screen recorder removed | A phone makes a video on the A54 and it passes the gates |
| **C4 Windows + web page** (3-4 days) | "Render in the cloud" option, `/make` page | Both produce identical-looking results |
| **C5 Ops** (2-3 days) | Abuse limits, Turnstile hook, monitoring and alerts, terms/privacy text, status page | Load test and security review pass |
| **C6 Self-host** (2 days) | Docker compose, docs, CI image build | A stranger can run it from the README |
| **C7 Later** | Server-side alignment of Apple's 30 s preview with a mic take to replace the mic sound with clean audio; more motion styles; accounts only if ever needed | Decided after real usage |

## 14. Risks and what to revisit

- **Skia parity**: some canvas features used by the scene (filters, `roundRect`, text shaping for Indic scripts) may differ; C0 decides whether a few effects need rewriting or whether a headless-browser worker is needed after all (slower, heavier).
- **Free-tier limits** change; keep the storage and worker behind small interfaces so moving platforms is a config change.
- **Misuse** (people uploading ripped music): stays the uploader's responsibility; keep takedown handling simple; consider a "personal use" notice and short retention.
- **Mic quality** has a ceiling; the own-file path and the later preview-alignment idea are the real fixes.
- Revisit when usage grows: a persistent worker pool instead of one container per job, a CDN for results, accounts for higher limits, GPU encoding.

## 15. Questions for you

1. Are you comfortable with the rule "the server never fetches YouTube/Spotify/Apple; only uploaded files"? (It is what keeps the hosted service legal and unblockable.)
2. Hosted limits to start with: 3 jobs a day per person, 60 s parts. Good?
3. Which worker host should we try first: Google Cloud Run Jobs (free tier, scale to zero) or a small VPS you control?
