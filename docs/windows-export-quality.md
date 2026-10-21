# Windows lyric-video export: smooth, clean, post-ready

Status: **P0 built in 0.11.0** (constant frame rate, worker clock, no throttling, hardware encoder, quiet UI, warm-up, auto 30 fps, 1440p YouTube background, analyzer script). P1-P3 still to do. Owner: Dhruv. Written 2026-10-21 against Lyra 0.10.5.

Goal: a video made by Lyra on Windows that someone is happy to post to Instagram Reels, TikTok and YouTube Shorts as it is: **smooth motion, clean sound, sharp picture, nothing that looks like a screen recording of a busy PC.**

---

## 1. What is wrong today (measured, not guessed)

Sample: `Barsaat - Banjaare (9x16 1080p).mp4`, made by the live recorder on the owner's laptop (RAM at about 98%).

| Measure | Value | Target |
|---|---|---|
| Frames written | 4,872 in 188 s | 11,280 at 60 fps |
| Average frame rate | **25.9 fps** | 60 (or a steady 30) |
| Median gap between frames | 16.7 ms (fine) | 16.7 ms |
| 99th percentile gap | **583 ms** | < 20 ms |
| Longest freeze | **933 ms** | < 40 ms |
| Gaps over 200 ms | **175** | 0 |
| Frame rate per 10 s window | from **9 to 60** fps | flat |
| Audio loudness | -14.0 LUFS, range 3.4 LU | -14 LUFS (already good) |
| Audio / video length | 185.3 s / 188.1 s | video = audio + 2.8 s end card (ok) |

Reading: when the machine has room, frames arrive on time (median 16.7 ms). Then they stop for up to a second, then a burst arrives. That is what "laggy" looks like: **freezes**, not a low frame rate. The sound is fine.

Two more things the sample shows:

1. **The picture is soft and wrong.** The YouTube background is a 16:9 clip cropped to 9:16, so it is heavily zoomed and blurry, with black bars still showing top and bottom. The video itself is a fan edit (movie scene), not the music video. The auto-pick chose it.
2. **Lyrics are small and low contrast** on a busy picture (one dim line on a bright face).

### Extra experiment (this session)

Same recorder, 720p, 30 s clip, window minimized for 10 s in the middle:

- First ~15 s: 16-19 fps with a 2.7 s freeze at second 2-4 (start-up cost).
- While minimized: about 20 fps.
- Afterwards: a perfect, flat 30 fps.

So: **a start-up stall, plus Chromium throttling the window when it is covered or minimized.** On a loaded PC both get worse.

## 2. Root causes (from the code)

Live recording (`src/renderer/src/lib/studio/recorder.ts`) does everything in one place, in real time:

1. **Everything runs on the renderer's main thread**: a `requestAnimationFrame` loop draws the scene at 1080x1920, builds a `VideoFrame`, feeds the encoder, and also handles PCM chunks, progress updates and the React UI. Any hiccup (garbage collection, a swap to disk, another window) delays the whole chain.
2. **`requestAnimationFrame` stops or slows when the window is hidden, covered or minimized.** The main window is created with `backgroundThrottling: true` (`src/main/window.ts`). A user who starts a recording and goes to do something else gets freezes.
3. **Frames are stamped with the wall clock and skipped when late.** Late frames are dropped (`encodeQueueSize` limit) and the next one carries the later timestamp. The result is a variable-rate file with holes of 0.5-0.9 s. Players show a hole as a freeze.
4. **The YouTube background is expensive**: a hidden window paints at 30 fps, the main process turns each frame into a JPEG (`toJPEG(88)`), sends it over IPC, and the renderer decodes it (`createImageBitmap`) - 30 times a second, all while the recorder runs.
5. **The mini player keeps playing its own copy of the video** and re-rendering during the export (a second embed and a second decode).
6. **No hardware encoder preference** is set (`VideoEncoder` default), and 60 fps doubled the work in 0.10.3.
7. **The background pick is not checked well enough** (fan edits, movie clips, reaction videos), and the crop for a 16:9 source in a 9:16 frame is too aggressive.

## 3. Requirements

Functional
- F1. Live export of the song as it plays (Spotify's own sound only) - keep.
- F2. Own-audio-file export - keep (already smooth: it is not real time).
- F3. 9:16, 4:5, 1:1, 16:9; 720p, 1080p, 1440p; 30 or 60 fps.
- F4. Backgrounds: YouTube video, Apple clip, user media, cover colours.

Non-functional (the part that matters)
- N1. **No visible freeze**: in a 3-minute video, 0 gaps over 40 ms and the 99th percentile gap under 20 ms (60 fps) / 40 ms (30 fps), on a normal laptop with other apps open.
- N2. **Audio exact**: no drift, no clicks, level -14 LUFS (+/- 1), true peak under -1 dBTP, audio and picture in step within 40 ms.
- N3. **Works while the user does other things** (window covered or minimized).
- N4. **Degrades gracefully**: a slow PC gets a smooth 30 fps video, never a stuttering 60.
- N5. Output accepted by Instagram, TikTok, Shorts without being re-processed badly: H.264 High, yuv420p, 1080x1920, AAC-LC 48 kHz, constant frame rate, closed GOP, `moov` at the front.

Constraints: Electron 44 / Chromium WebCodecs, no native video library (keep the app small), a solo maintainer, open source, Windows 10+ for the Spotify-only sound helper.

## 4. Design

### 4.1 Principle: capture what must be real time; render everything else offline

Only two things are truly real time: **the song's sound** and **the YouTube picture**. Drawing lyrics is not. So split the export in two phases.

```
 PHASE 1  CAPTURE (real time, light)                 PHASE 2  RENDER (any speed, deterministic)
 ---------------------------------                   ----------------------------------------
 lyra-audio.exe  --PCM-->  audio.wav (disk)          for frame n = 0..N-1 at exact time n/fps:
 Spotify position samples  -> timeline.json  ------>    read lyric position from timeline
 YouTube stage  --frames-> bg.mjpeg / H.264 (disk)      read background frame for that time
                                                        draw scene -> VideoFrame (CFR timestamps)
                                                        encode (hardware if possible)
                                                      mux with audio.wav -> AAC -> MP4 (+ end card)
```

- **Capture** only writes bytes to disk with timestamps. It cannot drop frames of the final video, because the final video does not exist yet. It survives a covered window if the capture runs in the hidden stage/main process and not in a throttled page.
- **Render** is exactly what "My own audio file" already does (`fileExport.ts`): a fixed loop, constant frame rate, faster than real time, same result every time. It can never stutter; at worst it is slow.
- The user sees: *Recording (song plays) ... then Rendering (progress bar)*. The song only has to play once. A 3-minute song renders in roughly 1-3 minutes on a normal laptop.

### 4.2 The lyric clock

The scene needs "where in the song are we" for every output frame. Today it asks `getPosition()` live. In the new design Phase 1 records `(wallClock, spotifyPosition)` pairs every 250 ms plus the audio sample counter, and Phase 2 maps the audio timeline to the position by linear fit (the same way `getPosition()` interpolates). Audio time is the master clock: **lyrics follow the audio file, not the wall clock**, so sync cannot drift.

### 4.3 YouTube background capture

- Keep the hidden stage window (`startStage`), but replace `toJPEG` per paint with a cheaper path, in order of preference:
  1. `webContents.beginFrameSubscription` / shared-texture offscreen rendering (`offscreen: { useSharedTexture: true }` when available) so frames never leave the GPU until needed;
  2. JPEG at quality 80 and capture at **the final resolution only** (not 1080p when the output is 720p), 30 fps;
  3. a small ring buffer written to disk as one `.mjpeg` file with a timestamp index.
- Render reads the nearest earlier frame for each output time (30 fps source into 60 fps output = each frame shown twice; fine, and it removes the "burst" look).
- If the stage fails (embed blocked), fall back automatically to Apple clip, then cover colours, and tell the user *before* recording starts, not after.

### 4.4 Live-path fixes that stay useful (also apply to the new design)

Quick wins that can ship before the two-phase rewrite (phase P0 below):

1. **Constant frame rate with duplicates instead of holes.** Drive the loop from the audio clock; if a frame is late, encode the previous frame again at the right timestamp. File is CFR, a hiccup becomes a slightly repeated frame, never a freeze.
2. **Never throttle during export.** Set `backgroundThrottling: false` on the main window while exporting, `app.commandLine.appendSwitch('disable-renderer-backgrounding')` and `disable-backgrounding-occluded-windows`, and hold a `powerSaveBlocker`.
3. **Do the rendering in a Worker** (`OffscreenCanvas` + WebCodecs in a worker). The UI thread then cannot stall the video, and the video cannot stall the UI.
4. **Quiet the app while exporting**: pause the mini player's own backdrop video, stop non-essential timers, lower React updates (progress only twice a second).
5. **Ask for a hardware encoder**: `hardwareAcceleration: 'prefer-hardware'`, fall back to software if `isConfigSupported` says no; choose bitrate mode `constant` for predictable pacing.
6. **Adaptive quality**: measure skipped frames in the first 10 s; if over 5%, switch automatically to 30 fps (still CFR) and tell the user once. (0.10.5 already measures and remembers a slow PC; this makes it automatic mid-recording.)
7. **Start-up**: wait until the stage has delivered frames and the song is at the start position *before* starting the clock (today the first seconds are the worst).

### 4.5 Audio

- Keep the WASAPI process-loopback helper (Spotify only, 48 kHz stereo s16).
- Write PCM to disk during capture; render step encodes AAC-LC **256 kbps**, 48 kHz.
- Fill silent gaps from the helper with exact zeros using the sample counter (not wall time) so length is exact.
- Loudness: measure integrated loudness of the captured track; apply gain to reach **-14 LUFS**, and a true-peak limiter at **-1 dBTP** (small JS implementation, or a one-pass ffmpeg-free biquad + lookahead limiter). 100 ms fade in, 300 ms fade out; the end card has the song fade out.
- A/V sync calibration: a one-time self-test plays a click through the helper path and measures the offset between audio sample time and frame time; store it in settings (`audioOffsetMs`).
- Own-audio mode: same normalization; also decode with the correct sample rate (already fixed in 0.6).

### 4.6 What makes it look good enough to post

Design (scene):
- **Safe zones** for Reels/Shorts/TikTok: keep text and song bar inside the middle ~70% of a 9:16 frame (top ~14% and bottom ~22% are covered by the platforms' UI). Today the song bar and badge sit exactly where the platform buttons are.
- **Bigger, bolder lyrics** with a soft shadow plus a darkening gradient behind the text, so lyrics stay readable on any picture; current line white, next lines 40% / 16% (done in 0.10.2), word-by-word fill (kept).
- **Background treatment**: slow zoom (Ken Burns) on stills, slight blur and darken behind text when the picture is bright, film grain off by default.
- **Picture sharpness**: capture the YouTube stage at the output resolution, choose the crop from the thumbnail bars (exists) and **cap the zoom**; if zoom would exceed 1.6x, use a blurred copy of the picture behind a letterboxed sharp copy instead of an extreme crop.
- **Song bar** smaller, art + title only; "Made with Lyra" badge stays quiet; end card 2.8 s (keep).

Content (picking the video):
- Reject fan edits and movie clips in the auto pick: require official-looking channel (artist name, `VEVO`, `- Topic`, label), title match, duration within +/- 20 s, not `lyrics`/`edit`/`reaction`/`slowed`/`reverb`.
- **Show the chosen video in the export dialog** (thumbnail + "Change video") before recording starts.

Delivery:
- **Presets**: *Instagram Reel / TikTok / Shorts* (9:16, 1080x1920, 30 or 60 fps, safe zones on), *Instagram post* (4:5), *Square*, *YouTube* (16:9).
- MP4 container: `fastStart` so the file plays at once when shared; CFR; H.264 High L4.2 (30 fps) or L5.2 (60 fps 1440p); bitrate 12 Mbps for 1080p60 (current), 8 Mbps for 1080p30.
- Also save a **thumbnail** (the best lyric frame) next to the file; the caption helper stays.

## 5. Trade-offs

| Decision | Gain | Cost |
|---|---|---|
| Two-phase capture then render | Cannot stutter; exact A/V; works with other apps in front | Extra step and disk space (about 100 MB per song for PCM + frames); more code |
| Keep one phase, only fix pacing (P0) | Small change, ships in days | Still real-time: a very slow PC still drops frames (but as repeated frames, not freezes) |
| Capture YouTube frames at final resolution | Sharper | More disk/CPU during capture on 1440p |
| Duplicate-frame CFR | No freezes | A slow PC shows repeated frames (judder, but steady) |
| Hardware encoder | Cooler and faster | Quality differs by GPU; need software fallback |
| Native libs (ffmpeg) | Much simpler muxing and loudness | +60-100 MB installer; we avoid it for now |

## 6. Test plan (the part that keeps it good)

A repeatable benchmark so "smooth" is a number, not an opinion:

- `scripts/export-bench.js` (extends the existing `scratch/export-test.js` harness): runs live and own-audio exports for 30 s at 720p/1080p, 30/60 fps, under four conditions (idle, window minimized, another heavy process, memory pressure).
- It then runs `ffprobe` on the result and prints: average fps, p50/p99/max frame gap, count of gaps over 2x the frame time, audio length vs video length, integrated loudness (`ebur128`), true peak.
- **Acceptance gates**: p99 gap under 1.5x frame time; zero gaps over 3x; audio/video length difference under 50 ms plus the end card; loudness -14 +/- 1 LUFS; peak under -1 dBTP.
- A/V sync: a click track played from a test file; measure click-to-flash offset; must be under 40 ms.
- Visual checks: golden frames for 9:16 / 4:5 / 1:1 / 16:9 with long and short lyrics, Hindi/Punjabi text, bright and dark pictures; safe-zone overlay image for review.
- Add the sample from this analysis as the "before" baseline in the repo notes.

## 7. Rollout

| Phase | Content | Done when |
|---|---|---|
| **P0** (about 3-4 days) | CFR with duplicate frames; no background throttling + power blocker; hardware-encoder preference; quiet UI during export; start-up warm-up; auto-drop to 30 fps; benchmark script | Benchmark passes on the dev laptop under "idle" and "minimized"; owner's laptop sample has no gaps over 100 ms |
| **P1** (about 1 week) | Worker rendering; cheaper stage frame path; stage at output resolution | 1080p60 live holds 59-60 fps on the dev laptop with a second app busy |
| **P2** (about 1-2 weeks) | Two-phase capture then render; lyric clock from audio; progress UI for rendering; loudness + limiter; sync calibration | A 3-minute song exports with zero freezes even with the window minimized |
| **P3** (about 1 week) | Visual polish: safe zones, bigger lyrics, background treatment, crop cap, thumbnail; better auto-pick and video preview; platform presets; fast-start MP4 | Side-by-side review of 10 songs looks post-ready; owner signs off |
| **P4** | Android own-audio export and cloud export reuse the render phase | Separate plans |

## 8. Risks and what to revisit

- **Shared-texture offscreen capture** may not be available on every GPU; keep the JPEG path as fallback.
- **Hardware H.264 at 1440p60** is not on every laptop; `isConfigSupported` decides, otherwise cap at 1080p60.
- **Disk use** of the capture phase; delete temporary files on success, failure and next start.
- **Lyric clock mapping** needs care when the user seeks or pauses during capture; record pause/seek events and either cut or mark the take as invalid.
- **Spotify position accuracy** (about +/- 250 ms from the web player state): the audio clock fixes drift but not the original lyric offset; keep the existing per-song "sync" nudge in the dialog.
- Revisit once everything is smooth: lossless audio option, 4K, subtitles in two scripts (romanization, issue #1), and moving the render phase to the cloud (separate plan).

## 9. Open questions

1. Is a two-step flow (record, then render) acceptable for the owner, or must the file be ready the moment the song ends? (Phase P0/P1 keep the single step; P2 adds the render wait.)
2. Disk budget for the capture phase (suggested: 500 MB cap with a clear message).
3. Should "Instagram Reel" be the default preset in the dialog?

---

## 10. P0 result (0.11.0)

Same machine, 33 s live recording, 1080x1920, 60 fps, YouTube background:

| | Before (sample) | After |
|---|---|---|
| Frame gaps over 2.5x | 260 | **0** |
| Longest freeze | 933 ms | **16.7 ms** |
| Frames in file | 25.9 fps average | **60.0 fps, constant** |
| Window minimized for 12 s mid-recording | 20 fps then repeats | **no change in smoothness** |
| YouTube picture | 1080p stage, upscaled | **2560x1440 stream** (asked for the best size not above the part shown) |

Check any video with `node scripts/analyze-video.js file.mp4` (needs ffprobe/ffmpeg; set `FFPROBE` / `FFMPEG` if they are not on the PATH).
