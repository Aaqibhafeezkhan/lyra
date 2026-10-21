# Android lyric video: sound that works, smooth 60 fps, a Reels-ready look

Status: plan (nothing here is built yet). Owner: Dhruv. Written 2026-10-21 against Lyra Android 0.3.2. Companion to [windows-export-quality.md](windows-export-quality.md); the Windows work (0.11-0.13) is the model for the quality bar.

Goal: on a normal phone, one tap makes a **1080x1920 video with the song's real sound, smooth motion and the same polished look as the Windows export**, ready to post.

---

## 1. Where Android stands today (measured on the Galaxy A54, Android 16)

How it works now: `RecordActivity` shows a web page (`record.tsx`, plain HTML/CSS lyrics over the song's video), `RecordService` holds a MediaProjection (screen capture consent), and `ScreenRecorder` mirrors the **whole display** into a H.264 encoder and records sound into an AAC encoder.

| Area | Finding |
|---|---|
| Picture | Works and looks good in a short test. Output is **1080x2340** (the phone's own shape, 19.5:9), not 9:16, so Instagram/TikTok crop or letterbox it. |
| Frame rate | A 42 s test file had 2,300 frames = **55 fps average, variable**. Frames come at whatever rate the screen produces them; nothing guarantees 60. No smoothness test exists for Android yet. |
| Sound, Android capture | Capture starts, Lyra's own test tone is captured, but **Spotify's sound never arrives** (all zeros). Spotify is allowed to be captured (`ALLOW_AUDIO_PLAYBACK_CAPTURE`), its player is `USAGE_MEDIA`, but its stream stays on the speaker output; the capture's output thread stays in standby. Same result for a fresh Spotify stream. Not confirmed for other apps. |
| Sound, microphone fallback (0.3.1) | Works: the song is heard through the mic after 5 s of silence. Measured level about **-30 dB mean**: quiet, unnormalized, depends on volume and room. Useless with headphones. |
| Look | Different from Windows: DOM/CSS page, no safe zones, no look options (style, font, highlight), no cover picture, simpler end card. |
| While recording | The **whole screen** is filmed: notifications and the status bar can show up; leaving the app ends the recording; the red screen-share chip is shown. |
| Reliability | A failed start once left the capture registered ("could not register audio policy"); fixed in 0.3.2. Nothing reports problems to the user in plain words. |
| Test devices | One phone. |

## 2. Requirements

Functional
- F1. Record a lyric video of the song playing now (Spotify first) with its sound.
- F2. Same looks as Windows: layouts, fonts, highlight colour, text position, end card, cover picture.
- F3. 9:16 1080x1920 (and 720p); 30 or 60 fps.
- F4. Save to Movies/Lyra and offer to share.
- F5. Optional: lyric video from the user's **own audio file** (always has perfect sound).

Non-functional
- N1. **Sound present and clean on every supported phone**: either the real stream or an honest fallback, never a silent file without a warning.
- N2. **No visible freeze**: p99 frame gap under 1.5x frame time, no gap over 3x, measured with the same analyzer as Windows.
- N3. Output loudness -14 LUFS +/- 1, peak under -1 dBFS.
- N4. Works while the user does other things where Android allows it; survives a phone call, screen lock and low battery in a defined way (stop and save what exists).
- N5. Privacy: nothing leaves the phone; clear consent text for screen and microphone use.
- N6. Open source friendly: no proprietary SDKs; compatibility data can be reported by contributors.

Constraints: Kotlin shell + the shared React UI in a WebView, minSdk 26, AudioPlaybackCapture needs API 29, Android 14+ MediaProjection rules (consent each time, foreground service type), one test phone, solo maintainer.

## 3. Root causes and what we do not know yet

1. **No frame-rate control.** The VirtualDisplay mirrors the screen at its refresh rate (the A54 switches between 60 and 120 Hz); the encoder is told 30 fps. Result: variable rate, some stalls under load.
2. **The picture is the screen, not a render.** Anything on screen (notifications, the system bars during gestures, other apps) can enter the video, and the shape follows the phone.
3. **Sound depends on the phone's audio policy**, which we do not control. The microphone is the only universal fallback and it is acoustic.
4. **Live audio is encoded as it arrives**, so it cannot be normalized or cleaned afterwards.
5. **The look lives in HTML/CSS** and has drifted from the Windows scene.

Unknowns (to be settled by the first spike, section 8):
- Is the capture failure specific to Spotify, or does the A54 not route *any* other app's sound? (Test with YouTube Music, VLC, the browser.)
- Does playback capture work for Spotify on other phones (Pixel, other Samsung, Xiaomi)?
- Does WebCodecs (`VideoEncoder`, `AudioEncoder` AAC) work in the Android WebView of current phones? That decides whether an offline render like Windows' "Smooth" method can run inside the app.
- Does a **private virtual display with a `Presentation`** (own content, no screen mirroring) work with a WebView and a YouTube iframe on this phone?

## 4. Design

### 4.1 Three ways to get sound (a ladder, tried in this order)

```
 1. Real stream      AudioPlaybackCapture (Spotify only: addMatchingUid)        best, when the phone allows it
 2. Own audio file   user picks the song file; no capture, no microphone         perfect, needs the file
 3. Microphone       acoustic recording of the speaker (auto fallback)           works everywhere, lower quality
```

- **Probe before recording.** In the dialog, a 3-second "sound check" starts the capture and the mic listener while the song plays, and reports in plain words: "Lyra can capture the song directly" / "Your phone does not share this app's sound; Lyra will listen through the microphone (play it on the speaker)" / "Headphones are connected: the microphone cannot hear them; pick an audio file instead". The user decides *before* the 3-minute recording, not after.
- **Headphones detection** (`AudioManager.getDevices`, output types wired/Bluetooth/USB): warn and steer to the own-file mode.
- **Remember the result per phone + app** (a small settings entry) so the next recording skips the probe.
- Keep the 5-second silence switch as a safety net, but shorten to 2 s after the probe has said capture works.

### 4.2 Two-step audio, like Windows' Smooth method

Today audio is encoded live. New: **keep the raw sound as PCM in a temporary file while recording, then post-process and encode at the end**:

```
 RECORD   PCM (capture or mic) ---> temp .pcm file (48 kHz stereo 16-bit, about 35 MB per 3 min)
 FINISH   read the .pcm  ->  loudness estimate  ->  gain to -14 LUFS  ->  soft ceiling -1 dBFS
          -> 80 ms fade in / 300 ms fade out  ->  AAC encode (fast, offline)  ->  mux with the finished video
```

- For the **microphone** path add a gentle clean-up: high-pass at 60 Hz, a noise floor estimate with light gating, and normalization (the measured -30 dB result would become -14 LUFS).
- The video is first written as a video-only MP4 by the encoder; the final step muxes video + AAC with `MediaMuxer`/`MediaExtractor`. Cost: a few seconds at the end.

### 4.3 Picture: render a 9:16 page ourselves instead of filming the screen

**Preferred design (spike S3): a private virtual display with a Presentation.**

```
 RecordService --creates--> VirtualDisplay 1080x1920 (own content, 60 fps) ---> H.264 surface encoder
        |
        +--> Presentation (a Dialog on that display) hosting the record WebView
```

- Output is exactly 1080x1920 whatever the phone's shape.
- **No notifications, no status bar, no other apps in the picture**, and no screen-share consent for the video (consent is only needed for audio capture; if the user picks the own-file or microphone path, no MediaProjection is needed at all).
- The user can leave the app and use the phone while it records (the service keeps running, the display is private).
- Lock the page to a steady 60 Hz (`Surface.setFrameRate`, `preferredRefreshRate`) and set the encoder to 60 fps, constant frame rate (`KEY_FRAME_RATE`, `KEY_MAX_FPS_TO_ENCODER`, `KEY_REPEAT_PREVIOUS_FRAME_AFTER`), High profile, bitrate 12 Mbps (1080p60) / 8 Mbps (30 fps).

**Fallback design:** keep mirroring the real display (today's method) but set the activity to `preferredRefreshRate = 60`, portrait lock, immersive mode, and record at 1080x1920 by scaling and cropping the mirrored display to 9:16.

### 4.4 One look for both platforms

Move the record page from DOM/CSS to the **shared canvas scene** (`src/renderer/src/lib/studio/scene.ts`): the page draws the scene at 60 fps into a full-screen `<canvas>`; the layouts, fonts, highlight, text position, safe zones, readability band, badge and end card then match Windows by construction. The page gets the same options as the Windows dialog (style, font, highlight, position, show song) in `RecordDialog`.

- Background: the song's YouTube video (iframe under the canvas, as in the mini player) or the Apple clip or the cover colours; the Windows "bars" crop and "wrong video?" list are reused.
- End card and a **cover JPEG** (saved next to the video) are produced the same way as on Windows.

### 4.5 Own-audio lyric video on Android (always smooth, always has sound)

If the WebView supports WebCodecs (spike S2): reuse `fileExport.ts` as is: decode the audio, draw frames at exact times, encode, mux to MediaStore. It runs faster than real time and cannot stutter. If WebCodecs is missing: a native renderer is needed (Skia-free path via `Canvas` on a `Surface` into `MediaCodec`), which is a larger task; decide after S2.

This also gives a cheap way to get **real sound for Spotify users on phones that block capture**: the Spotify song is not available as a file, so the own-file mode serves people with their own music files, and the microphone path serves everyone else.

### 4.6 Failure handling

| Situation | Behaviour |
|---|---|
| User denies microphone / screen consent | Plain message and a button to try again or choose the own-file mode. |
| Start fails halfway | Release every piece (already in 0.3.2), delete the half-made file, tell the user why. |
| Phone call / audio focus lost | Stop, save what exists, say so. |
| Screen locks / battery saver | Hold a wake lock during recording; at under 10% battery warn before starting; at 3% stop and save. |
| Storage under 500 MB | Warn before starting; stop and save when under 100 MB. |
| Song changes / user pauses | Same rules as Windows (stop after 5 s of pause, or when the track changes for 2 s). |
| The phone does not support 1080p60 | Use 1080p30 or 720p, automatically, and say so (probe with `MediaCodecList`). |
| Spotify plays on another device (Connect) | Detect `playbackState` device = not this phone; tell the user the phone makes no sound to capture. |

### 4.7 Privacy and store notes
- Screen capture and microphone are used only while recording and are described in `PRIVACY.md` (already updated for 0.3.1).
- F-Droid / IzzyOnDroid: no proprietary libraries; `FOREGROUND_SERVICE_MEDIA_PROJECTION` and `_MICROPHONE` types declared.

## 5. Trade-offs

| Decision | Gain | Cost / risk |
|---|---|---|
| Private virtual display + Presentation | Exact 9:16, clean picture, multitasking, no screen consent for video | Needs a spike: WebView and YouTube iframe on a secondary display may behave differently; fallback exists |
| Canvas scene instead of DOM | Identical look on both platforms, less code to maintain | The page must hold 60 fps in the WebView on mid-range phones; mitigate with 30 fps option |
| PCM temp file then encode at the end | Normalization, cleaner mic audio, exact length | Few seconds more at the end; ~35 MB temp per 3 min |
| Sound check before recording | The user knows what they will get | One extra step (3 s) the first time |
| Microphone fallback stays | Works on every phone | Acoustic; poor with headphones |
| Own-file mode | Perfect sound | Needs the file; needs WebCodecs or a native renderer |
| One test phone | Fast | Blind spots: need a compatibility report from contributors |

## 6. Test plan

- **Smoothness:** pull the saved MP4 and run `node scripts/analyze-video.js` (same gates as Windows: p99 gap < 1.5x frame time, max gap < 3x, constant 60 fps). A script `scripts/android-record-bench.sh` drives the flow over `adb` (taps, wait, pull, analyze) so a regression shows up in minutes.
- **Sound:** analyzer loudness gate (-14 +/- 1 LUFS, peak < -1 dBFS); a click-track test (a short tone burst played in the app and in the video) to measure the audio/video offset (target under 40 ms).
- **Capture matrix** (issue #19): table of phone model x Android version x app (Spotify, YouTube Music, VLC) x result (stream / silent / mic). Add an in-app **"Copy compatibility report"** button (model, Android version, which path worked, no personal data) so contributors can paste results into the issue.
- **Interruptions:** call, lock, low battery, headphones plugged mid-recording, low storage, app killed.
- Unit tests for the PCM post-processing (loudness, ceiling, fades) in the shared TypeScript so they run in CI.

## 7. Rollout

| Phase | Content | Done when |
|---|---|---|
| **A0** (1-2 days) | Baseline numbers: run the analyzer on a fresh recording; sound check of YouTube Music and VLC with the capture; write the compatibility-report button; add `scripts/android-record-bench.sh` | We know if capture is Spotify-only or device-wide |
| **A1** (3-4 days) | 60 Hz lock + encoder 60 fps CFR settings; wake lock, portrait lock; headphone detection and the sound-check dialog; friendly error texts; storage/battery guards | Bench passes smoothness gates on the A54; no silent file without a warning |
| **A2** (about 1 week) | PCM temp file, loudness + ceiling + mic clean-up, final AAC encode + mux | Mic videos reach -14 LUFS +/- 1; analyzer passes sound gates |
| **A3** (about 1 week) | Canvas scene page + look options + cover picture + end card parity | A side-by-side with Windows looks the same |
| **A4** (spike then 1 week) | Presentation on a private virtual display, exact 1080x1920, multitasking | Recording survives leaving the app; no notifications in the video |
| **A5** (spike S2 then 1-2 weeks) | Own-audio render on Android (WebCodecs) | Own-file video exports faster than real time, smooth |

Spikes first (each half a day): **S1** YouTube Music/VLC capture on the A54; **S2** WebCodecs encode support in the phone's WebView (`isConfigSupported` for avc1.640034 and mp4a.40.2 from the page); **S3** a Presentation with a WebView and a YouTube iframe on a private virtual display.

## 8. Risks and what to revisit

- **Capture may never work for Spotify on Samsung.** Then the microphone + own-file ladder is the product; revisit if Spotify or Samsung change their audio policy.
- **Presentation on a virtual display** may break YouTube playback (DRM/hardware decode on non-primary displays). Fallback: mirror the real display at 1080x1920.
- **WebCodecs on Android WebView** may lack the AAC encoder; then audio is encoded natively (MediaCodec) from the PCM file anyway (already planned in 4.2), and only video uses WebCodecs, or both are native.
- **Thermal and battery** at 1080p60 for 3+ minutes on mid-range phones; offer 30 fps when the phone reports thermal status "moderate" or higher (`PowerManager.getCurrentThermalStatus`).
- **Android 15/16 changes** to MediaProjection (partial screen sharing, single-use tokens) can change the consent flow; keep the code behind one small class.
- Revisit later: cloud rendering of own-audio videos (separate plan), 4K, stereo-aware mic cleanup, more music apps.

## 9. Open questions

1. Do you have a second Android phone (or a friend) for the compatibility matrix? Even one other brand helps a lot.
2. Is 9:16 only enough for Android, or do you also want 4:5 / 1:1 like Windows?
3. Should the default sound mode be "ask me" (probe each time) or "remember the last choice"?
