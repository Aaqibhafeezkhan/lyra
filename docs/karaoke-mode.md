# Lyra Karaoke: sing along to the backing track, with the lyrics

Status: design and feasibility (nothing built yet). Owner: Dhruv. Written 2026-10-23 against Lyra Windows 0.15 / Android 0.3.7.

**Short answer: yes, it is possible, but the hard part is not the lyrics or the microphone. It is getting a backing track without the vocals.** Spotify does not offer one, and nobody can take the voice out of Spotify's stream for you. This document says where a backing track *can* come from, what each source gives you, and how to build the mode in steps that each work on their own.

---

## 1. What the feature is

You pick a song. Lyra plays only the music (no singer), shows the lyrics big and word by word like a karaoke screen, and you sing into the microphone. Optional extras: practice tools, a score, and recording your performance as a lyric video you can post.

What Lyra already has and will reuse: synced lyrics with word timing (LRCLIB + estimates), the big lyric screen, a YouTube search/embed pipeline (with the user's key), a Spotify connection, the Studio (lyric video with exact audio and loudness mastering), the own-audio-file mode, the Windows Spotify-only sound capture helper, romanization for Hindi/Punjabi.

## 2. The honest part: where does the vocal-free music come from?

| Source | What it is | Pros | Cons |
|---|---|---|---|
| **A. A ready-made karaoke / instrumental version** found on YouTube (official "karaoke version", "instrumental" uploads by karaoke channels) and played in the embedded player | Lyra searches for `<title> <artist> karaoke / instrumental`, ranks results like it ranks music videos, plays the best one | No audio processing; works on Windows and Android; legal (official embed); good for popular songs | Coverage is uneven (less for new or regional songs); timing can differ from the original by a few seconds; some versions have their own lyrics burned in; needs the user's YouTube key |
| **B. An instrumental / karaoke track on Spotify** | Search Spotify for `<title> (Instrumental)` or a karaoke version and play it with Spotify's own controls | Plays inside Spotify as today; position is exact | Playing a chosen track needs Spotify's Web API with a **Premium** account and sign-in; many songs have no instrumental on Spotify |
| **C. Vocal removal from the user's own audio file** | The user picks a file (MP3/FLAC they own); Lyra separates voice and music **on their PC** with an open-source model, then plays the music part | Works for any song the user has; perfect sync with the file; also gives a **vocal reference** for scoring | The user needs the file; the model is a download (about 100-300 MB, optional); separation takes about 1-3 minutes per song on a laptop CPU; quality is good but not magic (a little voice can remain) |
| **D. Remove the voice from Spotify live** (Windows only: capture Spotify's sound, remove the vocals in real time, mute Spotify, play ours) | Technically possible with the existing capture helper | No file needed | Needs real-time separation with a delay of several seconds; muting another app's output; pause/seek feel laggy; fragile. **Not recommended** |
| **E. Simple "center cancel" (phase inversion)** | Subtract left from right | Instant, tiny code | Poor: removes the bass and drums too, leaves reverb; only for toys |

What is **not** possible: asking Spotify for a stem or an instrumental of an arbitrary song, or removing the voice inside Spotify's player. Android cannot capture Spotify's sound at all (see the Android issues), so on Android only A, B and (later) C apply.

**Recommendation:** build **A first** (fast, works everywhere, no heavy tech), then **C** (the "real practice" mode with scoring), keep **B** for Premium users as a small add-on. Skip D and E.

## 3. Requirements

Functional
- F1. Karaoke screen: large lyrics, word-by-word highlight, a count-in before the first line, dots during instrumental breaks, next-line preview, optional Roman letters.
- F2. Backing from source A, B or C (user's choice, with the best available chosen automatically).
- F3. Practice tools: loop a section, pause/resume with a count-in, lyric offset nudge, hide-the-words practice (words fade out as you learn), line-by-line mode.
- F4. Microphone: input meter, a headphone reminder, optional echo/latency calibration.
- F5. Optional score (see 5.5).
- F6. Record the performance (microphone + backing) and turn it into a lyric video with the Studio.

Non-functional
- N1. Lyrics and music stay in sync within 50 ms for source C, within the user's nudge for A/B.
- N2. Microphone to ear latency low enough to sing (under 60 ms when monitoring); no monitoring through speakers (feedback).
- N3. Everything for source C runs on the user's device: no uploads.
- N4. The heavy model is an optional download, not part of the installer.
- N5. Android is not blocked by Windows-only parts.

Constraints: solo maintainer, free and open source, one test PC and one phone, no server.

## 4. High-level design

```
 SONG (title, artist, optional file)
        |
        v
  BACKING RESOLVER ---- A: YouTube karaoke/instrumental search  --> embedded player (audio + clock)
        |          \--- B: Spotify instrumental (Premium API)    --> Spotify position as clock
        |           \-- C: local vocal separation of a file      --> WebAudio player (audio + clock) + vocal stem
        v
  KARAOKE ENGINE  <---- LYRICS (LRCLIB synced, word timing, Roman letters)
        |   clock = position of the backing track
        |   count-in, loops, offset, hide-words
        |
        +--> MICROPHONE (getUserMedia, no echo cancel/AGC)
        |         |--> level meter, latency calibration
        |         |--> pitch tracking (YIN) + voice activity  --> SCORE (optional)
        |         '--> recorder (PCM)
        v
  SCREEN (karaoke view)                      EXPORT (Studio): backing + voice mix + lyric video
```

### 4.1 Source A: karaoke versions from YouTube
- Reuse `YoutubeCatalog` search with the query `"<title> <artist> karaoke"` then `"... instrumental"`; rank with a new `scoreKaraoke` (title contains karaoke/instrumental/backing track, channel is a known karaoke label or the artist, duration within 10 s of the original, not "cover", not "reaction", not "with vocals").
- Play in the embedded player (muted lyrics overlay is ours). The player's current time is the clock; the original's LRCLIB timing is applied with a per-song **offset** (shown as a nudge; stored per song) because karaoke versions often start a bit differently. A one-time "tap to sync" helper: the user taps at the first sung word; the offset is stored.
- Videos with burned-in lyrics are detected from the title and flagged ("this version shows its own words"); the user can still pick another.

### 4.2 Source B: Spotify instrumental (Premium)
- Search Spotify for `<title> instrumental` / `karaoke` and start it with the Web API (`PUT /me/player/play`, scope `user-modify-playback-state`); position comes from the existing Spotify source. Needs sign-in and Premium: show as "available if you have Premium".

### 4.3 Source C: local vocal separation
- Model: an open-source separation model exported to ONNX (Demucs-family or MDX-Net-family; licences to be checked in spike K2) run with `onnxruntime-node` in a worker process; chunked with overlap, progress bar, cancel, resumable.
- Output: two WAV/FLAC files in the app data folder: `music` and `vocals`, cached by file hash; the user can delete them. Never uploaded, never shared.
- Playback: `AudioBufferSourceNode` or `<audio>`; clock = `audioCtx.currentTime`; lyrics come from LRCLIB by title/artist/duration of the file, or from the user's `.lrc`, exactly as the Studio's own-file mode already does.
- The **vocal stem is the reference for scoring**: its pitch line (F0) is extracted once and cached.
- The same engine can be pointed at a file the user records themselves.

### 4.4 The karaoke screen
- Reuse the lyric view components in a new "stage" layout: current line huge, next line below, a progress bar per line (a ball/underline that sweeps), a 3-2-1 count-in before the first line and before every restart, instrumental-break dots, optional Roman line.
- Safe to use in full screen on a TV via the existing TV mode page (read-only lyrics, controls on the phone): a later bonus.

### 4.5 Microphone, latency, scoring
- `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`, input level meter; **ask for headphones** (speakers feed the backing track back into the microphone and ruin pitch detection and the recording).
- Latency: Windows WASAPI shared mode through Chromium has about 30-60 ms input latency; a calibration step plays a click and measures the round trip to set a **mic offset** used for timing and for aligning the recording.
- Pitch: a YIN/MPM detector in an `AudioWorklet` (about 20 ms hop) gives F0 in Hz plus a voicing confidence.
- **Score, three honest levels:**
  1. *Timing/voice* (works for every source): were you singing while a line was active, and silent during breaks (voice activity vs the lyric timeline). Gives "sang X% of the lines".
  2. *Pitch against the original melody* (**source C only**): compare your F0 contour to the vocal stem's F0 per note, forgiving octave shifts (men/women singing the same song) and a window of about +/- 50 cents. This is what makes it "real practice".
  3. *Pitch against nothing* (A/B): no reference melody exists, so show only level 1 and a live pitch line without a verdict. We will not fake a pitch score.

### 4.6 Practice tools
- Loop a chosen section (select lines), count-in on resume, speed control only for source C (time-stretch with a phase vocoder; later), "hide words" mode that fades a growing share of words as you repeat, per-line replay, bookmark the hard lines (reuse Lyra's saved-moments).

### 4.7 Recording and export
- While singing, the microphone is recorded to PCM next to the backing's clock. On finish: choose *mix* (backing + voice with a simple gain and a light compressor/limiter, loudness -14 LUFS using the Studio's mastering code) and the Studio makes the **lyric video of your performance**: your voice and the backing, the lyrics with word fill, and your cover/background look. For sources A/B the backing's sound has to come from Lyra's own player (captured with Windows' process loopback of Lyra itself, or the own-file path for C). Source C is the clean one: both the music and your voice are files.
- Rights note in the UI: your recording contains the original music; sharing is the user's responsibility (same as any karaoke recording).

## 5. Data model (local)

```
KaraokeSong { id, title, artist, durationMs, backing:{ kind:'youtube'|'spotify'|'file', ref }, offsetMs, lyrics:{source, lines}, hasVocalRef:boolean }
Separation  { fileHash, musicPath, vocalsPath, f0Path, model, createdAt }
Take        { id, songId, recordedAt, voicePath, backingKind, micOffsetMs, score:{timing%, pitch%?}, videoPath? }
```
Stored in the app's settings/data folder; deleted from Settings -> Karaoke -> "Remove saved separations and takes".

## 6. Trade-offs

| Decision | Gain | Cost |
|---|---|---|
| Start with source A (karaoke videos) | Works in days, any platform, no model | Uneven catalogue, timing nudges, needs a YouTube key |
| Source C as the "real practice" mode | Perfect sync, a pitch reference, a clean recording for export | Needs the user's file; model download; minutes of processing |
| No live voice removal from Spotify (D) | Avoids a fragile, laggy design | You cannot sing to what Spotify is playing right now |
| Pitch score only with a vocal reference | Honest, meaningful number | A/B get a lighter "timing" score |
| Ask for headphones | Clean recording and pitch | One more step; speakers-only users get a warning |
| Local only | Private, no cost | Heavier on the user's PC |

## 7. Test plan
- **Timing:** a test file with a click track and its `.lrc`; measure the offset between lyric timing and audio (source C: under 50 ms); karaoke-video offsets stored and replayed.
- **Pitch:** synthetic sine sweeps and a sung sample set (male/female, octave off) for the YIN detector; target 95% of voiced frames within 50 cents.
- **Separation:** quality check on a small set (SDR-style listening notes) and speed on this PC; model files checked by hash.
- **Mic path:** headphones vs speakers recordings; latency calibration repeatability.
- **Export:** run `scripts/analyze-video.js` on the performance video (60 fps constant, -14 LUFS, peak under -1 dB).
- **Failure cases:** no microphone, microphone permission denied, no karaoke version found, separation cancelled, disk full.

## 8. Rollout

| Phase | Content | Exit gate |
|---|---|---|
| **K0 Spikes** (2-3 days) | K1: search quality of `karaoke`/`instrumental` queries for 20 songs of the owner's taste (including Hindi/Punjabi) and the offset between karaoke versions and LRCLIB timing. K2: ONNX separation model speed and quality on this PC, and its licence. K3: YIN detector accuracy and mic latency on this PC. K4: Spotify `play` of an instrumental URI with a Premium account | Numbers decide the order of the rest |
| **K1 Karaoke screen + source A** (4-5 days) | Karaoke view, count-in, break dots, offset nudge + tap-to-sync, karaoke search/ranking, practice basics (loop, hide words) | A song sings end to end with good sync on the owner's phone and PC |
| **K2 Microphone + timing score** (3-4 days) | Mic meter, headphone prompt, latency calibration, voice-activity score, takes list | Score matches what the owner hears |
| **K3 Local separation (source C)** (1-2 weeks) | Optional model download, worker, progress, cache, own-file picker (reuse Studio file input), playback engine, vocal F0 reference | A file turns into music + vocals in about 1-3 minutes and plays in sync |
| **K4 Pitch score** (1 week) | F0 matching with octave tolerance, per-line feedback | Same song scored by two singers gives believable numbers |
| **K5 Export performance** (1 week) | Mix voice + backing, loudness mastering, Studio lyric video of the take | The performance video passes the analyzer gates |
| **K6 Polish** | TV mode view, Roman letters, speed control (time-stretch), Android layout, settings and cleanup | Checklist green |

## 9. Risks and what to revisit
- **Coverage of source A** may disappoint for regional songs; then C becomes the main path and the README says so plainly.
- **Separation quality and speed** may be worse than hoped on laptops without a GPU; ship the smaller model first, offer a better one later.
- **Licences** of model weights vary; use only models with a clear open licence and show the credit in `THIRD_PARTY.md`.
- **Feedback and latency** problems make singing without headphones frustrating; the headphone prompt is not optional in the design.
- **Spotify terms**: we only control playback of a track the user chooses; nothing is captured or altered.
- Revisit later: duets, a shared "room" where friends sing the same song together (the Rooms/Jam code exists), scoring of timing per word, pitch guide ribbon for source C.

## 10. Questions for you
1. Which first: the quick version (A: karaoke videos, any song that has one) or the "real practice" version (C: your own files, scoring)? My suggestion is A first, because it works for everyone in a few days, then C.
2. Do you have a YouTube key set up on your phone and PC already? (It is needed for A.)
3. Do you want the score to be a game feature (points, streaks) or just feedback?
