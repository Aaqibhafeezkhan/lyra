# Android lyric video, designed again from zero: listen, then render

Status: plan v2 (replaces the screen-recording plan). Nothing here is built yet. Owner: Dhruv. Written 2026-10-21 for Lyra Android 0.3.x; the quality bar is the Windows "Smooth" export (see [windows-export-quality.md](windows-export-quality.md)).

**Why a new plan.** The first Android version filmed the phone's screen. That design is the source of the pain: the picture is whatever is on the screen (notifications, odd shape), the frame rate is whatever the display does, the sound depends on a phone setting we cannot control, and any hiccup while recording is permanent. Windows got smooth and reliable only when it stopped *recording the video live* and started *recording the song, then drawing the video afterwards at exact times*. Android gets the same treatment, with the parts that do not exist on a phone (screen capture of other apps' sound, a hidden YouTube window) replaced by things that do.

---

## 1. Goal and non-goals

Goal: tap once, get a **1080x1920, 30/60 fps MP4 with the song's sound and the same polished look as Windows**, saved to Movies/Lyra and ready to share. It must work the same on every phone, never film notifications, never stutter, never produce a silent file without saying so.

Non-goals (stated so nobody is surprised): the YouTube music video as a background on Android (a phone has no way to read another app's video frames; see 4.5), capturing Spotify's own digital sound on phones that block it, 4K.

## 2. What we learned (facts, not guesses)

- On the Galaxy A54 (Android 16) Android's audio playback capture accepts our request, captures Lyra's own sound, and **never receives Spotify's sound** (flinger shows Spotify's track on the speaker thread, the capture thread idle). Not confirmed for other apps.
- The microphone path works but was quiet (-30 dB) because nothing normalized it.
- Screen-mirroring gave 55 fps variable, the phone's own shape (1080x2340), and showed notifications.
- WebView + canvas + the shared TypeScript scene already draws the Windows look; only the *recording* differs per platform.
- The Windows pipeline (record sound and song position; render frames at exact times with WebCodecs; AAC; MP4) measured 60.0 fps constant, zero gaps, -13 LUFS.

## 3. Requirements

Functional
- F1. Make a lyric video of the song playing now (Spotify) for a chosen part (default: the next 30 s, or until the song ends).
- F2. Make one from the user's own audio file (no listening needed).
- F3. Same looks and options as Windows: style, font, highlight, text position, song bar, safe zones, end card, cover picture.
- F4. Backgrounds: cover motion (default), procedural motion styles, the Apple clip, the user's own video/photo.
- F5. 9:16 1080x1920 or 720x1280; 30 or 60 fps; saved to MediaStore; share sheet.

Non-functional
- N1. **Sound honest and good**: loudness -14 LUFS +/- 1, peak under -1 dBFS, fades; if the sound is silent or very quiet the user is told before saving.
- N2. **Smooth by construction**: constant frame rate, no gap over 1.5x frame time (same analyzer as Windows).
- N3. **No screen involvement**: no screen-share consent, no notifications in the video, works with the screen off or another app in front.
- N4. **Recoverable**: if the app dies mid-render, the recorded sound is kept and rendering can be resumed.
- N5. Privacy: microphone and files stay on the phone; temporary data is deleted after success.
- N6. Open source, no proprietary SDK; minSdk 26.

Constraints: Kotlin shell + shared React UI in a WebView; one test phone; solo maintainer; Android 14+ foreground-service rules.

## 4. Design

### 4.1 Overview: two steps and a mux

```
 STEP 1  LISTEN  (real time, tiny work, screen may be off)
   sound source --PCM--> audio.pcm (temp file)        +  timeline.json: song position every 100 ms
   (own file | microphone | playback capture)             + track info, cover, chosen options

 STEP 2  RENDER  (any speed, deterministic, cannot stutter)
   audio.pcm -> loudness gain -> ceiling -> fades ---------------------------> AAC (native)  --+
   timeline  -> lyric position for frame n                                                     +--> MediaMuxer --> MediaStore
   shared scene.ts draws frame n on a canvas -> WebCodecs H.264 chunks --RPC--> native -------+
```

Nothing in step 2 depends on what the phone is doing. A slow phone only takes longer.

### 4.2 Step 1: three sound sources (a ladder, with a sound check first)

| Rung | What | Quality | Needs |
|---|---|---|---|
| 1. Own audio file | the user picks a file; no listening step | perfect | the file |
| 2. Microphone | acoustic recording of the phone speaker | usable after cleanup | speaker, volume, quiet room |
| 3. Playback capture | Android's capture of the music app | perfect, when it works | phone allows it; MediaProjection consent |

- **Sound check (3 s) before listening starts.** It tries rung 3 and rung 2 while the song plays and tells the user in plain words what will happen: *"Lyra can capture the song directly"* / *"Your phone does not share Spotify's sound. Lyra will listen with the microphone: keep the sound on the phone speaker, turn it up, stay quiet"* / *"Headphones are connected: the microphone cannot hear them. Pick an audio file instead."* The result is remembered per phone and app.
- **Rung 3 is optional and last in the plan**: it only appears if the A0 spikes show it works on any phone; otherwise it is dropped to keep the product simple.
- **Microphone cleanup (in step 2, offline):** 60 Hz high-pass, a noise-floor estimate with light gating, then normalization. The earlier -30 dB result becomes -14 LUFS.
- **Where it runs:** a foreground service of type `microphone` started from the visible app (Android 14 rule), writing PCM to disk; the user can lock the phone. A phone call or lost audio focus stops listening and keeps what exists.
- **Song position** comes from the existing `MediaMonitor` (the media session): position, state, track id, every 100 ms, saved to `timeline.json`. Seeks and pauses are recorded as events; a take with a seek is cut at the seek or marked invalid.

### 4.3 Step 2: render engine = the shared scene in a hidden WebView

- A hidden `WebView` loads `android.html?render=1`. The page reads `audio.pcm` and `timeline.json` through a small asset-loader handler (`/rec/<id>/...`, streamed with range support), loads the cover, and runs the **same `scene.ts`** as Windows on a `canvas` at exact frame times.
- Frames go to `VideoEncoder` (WebCodecs, H.264 High, hardware where available). Encoded chunks (plus the codec description) are sent to Kotlin over the existing RPC bridge in small batches; Kotlin writes them to a `MediaMuxer` video track. Bitrate about 12 Mbps at 1080p60, 8 Mbps at 30 fps.
- **Audio is processed and encoded natively** from the PCM file (`MediaCodec` AAC-LC, 192 kbps), because AAC in WebCodecs is not available on every Android WebView. The processing (loudness estimate, soft ceiling, fades, high-pass for mic) is plain Kotlin with JVM unit tests.
- **If the phone's WebView cannot encode video** (spike S1 decides): *frame stepping fallback*: the page exposes `renderAt(t)`; Kotlin calls it for each frame, copies the drawn view into an EGL surface of a `MediaCodec` with an exact presentation time (the classic Grafika pattern). Slower (about 2-3x real time at 30 fps) but equally deterministic.
- Progress and cancel are RPC events; the render runs inside a foreground service so it survives leaving the app.
- Output: 1080x1920 (or 720x1280), constant frame rate, `moov` finalized by `MediaMuxer`, inserted in MediaStore with `IS_PENDING` until done.

### 4.4 Look parity (one scene for both platforms)

The Windows scene already has safe zones for Reels/TikTok/Shorts, a readability band, bigger lyrics, an end card and a cover picture. Android uses it unchanged; only the dialog is new. Anything added to the scene later appears on both platforms.

### 4.5 Backgrounds without YouTube (and why)

A phone cannot read the frames of another app or of a cross-origin YouTube player; the only way would be filming the screen, which is what this redesign removes. Android therefore ships with backgrounds we can draw ourselves:

1. **Cover motion (default):** blurred cover, slow zoom, colour-graded from the cover palette.
2. **Procedural motion styles** (a small set: aurora, slow gradient, soft particles, film grain) drawn by the scene with the cover's colours: premium look, no copyright, deterministic, tiny.
3. **Apple clip:** the free 30 s preview video looped (already proxied by `WebSetup`), drawn by seeking per frame.
4. **Your own video / GIF / photo** (the existing picker).

(The "Wrong video?" list and the YouTube background stay Windows-only.)

### 4.6 Own-audio mode is the same pipeline

Step 1 is skipped: the audio file is decoded to PCM (Kotlin `MediaExtractor`/`MediaCodec` decode or the page's `decodeAudioData`) and step 2 runs unchanged. This is the first thing to build because it proves the whole render path without any listening problem.

### 4.7 Interfaces

RPC (Kotlin <-> page), all small and versioned:
- `listenStart({ source, partMs, trackId })` / `listenStop()` / `listenStatus` event (level meter, seconds, source in use, warnings).
- `soundCheck()` -> `{ capture: boolean, mic: boolean, headphones: boolean, advice: string }`.
- `renderOpen({ recordingId, width, height, fps })`, `renderChunk({ bytes, ptsUs, key })`, `renderConfig({ description })`, `renderFinish()` -> `{ uri }`, `renderCancel()`.
- Files: `cache/rec/<id>/{audio.pcm, timeline.json, meta.json, cover.jpg}`; deleted after success or after 7 days.

### 4.8 Failure handling

| Situation | Behaviour |
|---|---|
| Microphone permission denied | Explain, offer own-file mode. |
| Headphones plugged | Warn before; if plugged mid-listening, stop and keep what exists. |
| Silent or very quiet take | Show a level graph and ask: render anyway, retake, or use a file. Never save silently. |
| Phone call, audio focus lost, low battery (<5%), storage < 300 MB | Stop listening, keep the PCM, say why, allow rendering. |
| App killed while rendering | On next launch: "Finish your video?" resumes from the saved PCM and timeline. |
| WebView lacks H.264 encode | Frame-stepping fallback; if that fails, 720p30. |
| Thermal status moderate or higher | Offer 30 fps; slow down rendering instead of overheating. |
| Spotify playing on another device | Detect that this phone is not the player; tell the user there is nothing to hear. |

## 5. Trade-offs

| Decision | Gain | Cost |
|---|---|---|
| Offline render instead of screen recording | Smooth, exact 9:16, no notifications, no consent chip, screen may be off | New pipeline to build; backgrounds limited to what we can draw |
| Shared TypeScript scene | Same look as Windows, one place to improve | Needs the WebView to hold decent drawing speed (30 fps option) |
| Native audio encode and mux | Works on every WebView | More Kotlin (PCM processing, MediaCodec, MediaMuxer) |
| No YouTube background | Removes the unreliable, un-testable part | Fewer backgrounds than Windows; replaced by procedural looks |
| Mic as a first-class rung with cleanup | Works on every phone | Still acoustic; headphones impossible |
| Sound check first | No surprises after a long take | One extra step the first time |
| Keep old screen recorder meanwhile | Nothing breaks during the build | Dead code until removed (planned for the phase after R3) |

## 6. Test plan

- **Smoothness and sound:** pull the MP4 and run `scripts/analyze-video.js` (constant fps, p99 gap < 1.5x, loudness -14 +/- 1, peak < -1 dB). A script `scripts/android-render-bench.sh` drives the flow over `adb` (own-file render, then a mic take with a played test track), pulls and analyzes, so every build is judged by numbers.
- **Audio/video offset:** a test track with a click every second and a flash in the scene; offset must be under 40 ms.
- **Unit tests (JVM/Vitest):** loudness estimate, ceiling, fades, high-pass, timeline interpolation, PCM chunking.
- **Interruption tests (manual checklist):** call, lock, headphones in/out, low storage, kill during render, rotate.
- **Compatibility report:** a "Copy compatibility report" button (model, Android and WebView versions, which rungs worked, render speed; no personal data) so contributors can fill the matrix in issue #19.
- Old recorder code is deleted once the new path passes the gates on the A54.

## 7. Rollout (each phase ends with numbers, not opinions)

| Phase | Content | Exit gate |
|---|---|---|
| **R0 Spikes** (1-2 days) | S1: WebView `VideoEncoder.isConfigSupported` for avc1.640034 1080x1920@60, and a 300-frame draw+encode speed test. S2: native AAC encode + `MediaMuxer` of WebCodecs chunks (description bytes) into a playable MP4. S3: mic path quality with the planned cleanup. S4: playback capture of other apps (YouTube Music, VLC) to settle the capture question. | We know which render path (WebCodecs or frame-stepping) and whether rung 3 exists |
| **R1 Render core** (3-4 days) | Own-audio file -> render -> MP4 in Movies/Lyra, shared scene, cover background, end card, progress + cancel, foreground service | Bench passes smoothness + loudness gates on the A54 |
| **R2 Listen** (3-4 days) | Mic listening service, timeline, sound check, headphone detection, cleanup, resume after kill | A mic take renders to -14 LUFS; offset under 40 ms |
| **R3 Dialog and look** (4-5 days) | New dialog: part, look options, sound source with check, progress, done + share + cover picture; Windows parity side by side | Looks identical to Windows on the same song |
| **R4 Backgrounds** (3-4 days) | Procedural styles, Apple clip, user media | Each background renders smoothly at 30/60 fps |
| **R5 Hardening** (3 days) | Interruptions, storage/battery/thermal guards, compatibility report, bench in the repo, remove the old screen recorder | Checklist green; old code gone |
| **R6 Optional** | Rung 3 capture (only if S4 says it works), research: align Apple's 30 s audio preview to the take to replace the mic sound with clean audio for short reels | Decided after R5 |

## 8. Risks and what to revisit

- **WebCodecs on Android WebView** may be missing or slow: the frame-stepping fallback exists; measure in S1 before building anything else.
- **Mic quality** has a ceiling; if users reject it, the own-file mode and the Apple-preview alignment idea are the answer, not more filtering.
- **Large PCM files** (35 MB per 3 min) are small enough; keep the part limited to 5 minutes.
- **Android policy changes** (microphone from background services, MediaProjection) are isolated in the listening service.
- Revisit later: a cloud render of the same step 2 (the cloud plan reuses it), more procedural styles, 4K, Apple/YouTube Music support.

## 9. Questions for you

1. Are you fine with **no YouTube video on Android** (procedural motion + cover + Apple clip + your own media instead)?
2. Do you want the old screen recorder kept as a hidden "quick record" until the new path is proven, or removed right away?
3. Default part length for a live take: 30 s? or until the song ends?
