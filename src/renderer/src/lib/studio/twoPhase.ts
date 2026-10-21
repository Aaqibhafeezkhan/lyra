import { Muxer, StreamTarget } from 'mp4-muxer'
import type { LyricLine, Track } from '@shared/types'
import { estimateWords } from '@shared/wordTiming'
import logoUrl from '@/assets/logo.png'
import { useBgState } from '@/store/bgState'
import { useLyrics } from '@/store/lyrics'
import { getPosition, usePlayer } from '@/store/player'
import { loudnessGainOf, seekVideo } from './fileExport'
import { dimensions, encoderConfig, loadImage, loadVideo, lookInputs, offsetNow, pickEncoder, softCeiling, type ExportOptions, type Fps, type Progress } from './recorder'
import { createScene } from './scene'
import { detectBars } from './stage'

/**
 * "Smooth" export in two steps, so the video can not stutter whatever the PC is doing:
 *
 *   1. RECORD (real time, almost no work): the song plays; Lyra only keeps the song's sound, the position of the song
 *      every 100 ms, and (for a YouTube background) the pictures of the video with their times.
 *   2. RENDER (any speed): the video is drawn frame by frame at exact times from what was kept, with the exact sound,
 *      exactly like an export from your own audio file. A slow PC only takes longer; it never drops a frame.
 */
const END_SECONDS = 2.8
const STAGE_FPS = 30

export interface SmoothResult {
  path: string
  seconds: number
  droppedPct: number
  fps: number
  sourceQuality: string
  coverPath: string | null
}

export async function exportSmooth(opts: ExportOptions, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<SmoothResult> {
  const track: Track | undefined = usePlayer.getState().snapshot?.track ?? undefined
  if (!track) throw new Error('Play a song first.')
  const lyrics = useLyrics.getState().state
  const lines: LyricLine[] = lyrics.phase === 'ready' && lyrics.result.status === 'synced' ? estimateWords(lyrics.result.lines, track.durationMs) : []
  const { w, h } = dimensions(opts.ratio, opts.quality)
  const FPS: Fps = opts.fps ?? 60
  if (typeof VideoEncoder === 'undefined') throw new Error('This computer can not encode video here.')
  if (!(await VideoEncoder.isConfigSupported(encoderConfig(w, h, opts.quality, FPS))).supported) throw new Error(`This PC can not encode ${w}×${h} video. Try a lower quality.`)

  onProgress({ stage: 'preparing', seconds: 0, total: 0 })
  const startMs = Math.max(0, Math.min(opts.startMs, track.durationMs - 1000))
  const endMs = Math.min(track.durationMs, Math.max(opts.endMs, startMs + 1000))
  const planned = (endMs - startMs) / 1000
  const safeName = `${track.title} - ${track.artists[0] ?? ''}`.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'lyra-video'
  const file = await window.lyra.studio.open(`${safeName} (${opts.ratio.replace(':', 'x')} ${opts.quality}).mp4`)
  if (!file) throw new Error('cancelled')

  useBgState.getState().setExporting(true)
  let aborted = false
  const abort = (): void => {
    aborted = true
  }
  signal.addEventListener('abort', abort)
  let capture: MediaStream | null = null
  const bitmaps = new Map<number, Promise<ImageBitmap | null>>()
  try {
    // ---------- pictures and video first
    const art = await loadImage(track.artworkUrl)
    const logo = await loadImage(logoUrl)
    let media: HTMLVideoElement | HTMLImageElement | null = null
    if (opts.mediaUrl && opts.mediaKind === 'video') media = await loadVideo(opts.mediaUrl)
    else if (opts.mediaUrl && opts.mediaKind === 'image') media = await loadImage(opts.mediaUrl)
    else if (opts.clipUrl) media = await loadVideo(opts.clipUrl)
    const mediaVideo = media instanceof HTMLVideoElement ? media : null
    mediaVideo?.pause()

    let sourceQuality = ''
    if (opts.youtube) {
      const needH = Math.min(1440, Math.max(720, Math.ceil(Math.max(h, (w * 9) / 16))))
      const st = await window.lyra.studio.stageStart({ videoId: opts.youtube.videoId, width: Math.round((needH * 16) / 9 / 2) * 2, height: needH, fps: STAGE_FPS, startSec: startMs / 1000 })
      if (!st.ok) throw new Error(`The YouTube video can not be used: ${st.reason ?? 'unknown reason'}. Pick Cover colours instead.`)
      sourceQuality = st.quality ?? ''
      await new Promise((r) => setTimeout(r, 600)) // let the first pictures arrive
    }

    // ---------- step 1: record (sound, song position, background pictures)
    const left: Float32Array[] = []
    const right: Float32Array[] = []
    let stored = 0 // sound frames kept so far
    let sampleRate = 48000
    let recording = false
    let t0 = 0
    let audioTrack: MediaStreamTrack | undefined
    let reader: ReadableStreamDefaultReader<AudioData> | null = null
    const keep = (l: Float32Array, r: Float32Array): void => {
      left.push(l)
      right.push(r)
      stored += l.length
    }

    const helper = await window.lyra.studio.audioStart()
    let offAudio: (() => void) | null = null
    if (helper.ok) {
      offAudio = window.lyra.studio.onAudio((pcm) => {
        if (!recording) return
        const frames = Math.floor(pcm.byteLength / 4)
        if (frames === 0) return
        const i16 = new Int16Array(pcm.buffer, pcm.byteOffset, frames * 2)
        // the capture sends nothing while Spotify is silent: fill those gaps with silence so sound and picture stay in step
        const gap = Math.round(((performance.now() - t0) / 1000) * 48000) - (stored + frames)
        for (let rest = gap; rest > 2400; rest -= 24000) {
          const n = Math.min(24000, rest)
          keep(new Float32Array(n), new Float32Array(n))
        }
        const l = new Float32Array(frames)
        const r = new Float32Array(frames)
        for (let i = 0; i < frames; i++) {
          l[i] = i16[i * 2]! / 32768
          r[i] = i16[i * 2 + 1]! / 32768
        }
        keep(l, r)
      })
    } else {
      // the whole PC's sound as a second choice
      capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints })
      capture.getVideoTracks().forEach((t) => t.stop())
      audioTrack = capture.getAudioTracks()[0]
      if (!audioTrack) throw new Error('This PC did not provide system sound.')
      reader = new (window as unknown as { MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioData> } }).MediaStreamTrackProcessor({ track: audioTrack }).readable.getReader()
    }
    let running = true
    const pump = (async () => {
      let first = true
      while (running && reader) {
        const { value, done } = await reader.read()
        if (done || !value) break
        if (first) {
          sampleRate = value.sampleRate
          first = false
        }
        if (recording) {
          const n = value.numberOfFrames
          const l = new Float32Array(n)
          value.copyTo(l, { planeIndex: 0, format: 'f32-planar' })
          const r = new Float32Array(n)
          if (value.numberOfChannels > 1) value.copyTo(r, { planeIndex: 1, format: 'f32-planar' })
          else r.set(l)
          keep(l, r)
        }
        value.close()
      }
    })()

    // restart the song at the start of the part
    await usePlayer.getState().command({ type: 'seek', positionMs: startMs })
    if (!usePlayer.getState().snapshot?.isPlaying) await usePlayer.getState().command({ type: 'play' })
    for (let i = 0; i < 40 && Math.abs(getPosition() - startMs) > 1500; i++) await new Promise((r) => setTimeout(r, 150))
    if (Math.abs(getPosition() - startMs) > 3000) throw new Error('Could not jump to the start of the part. Press play and try again.')

    const framesOnDisk = opts.youtube ? await window.lyra.studio.frameCaptureStart() : false
    if (opts.youtube && !framesOnDisk) throw new Error('Could not save the video pictures on this PC (is the disk full?).')
    t0 = performance.now()
    recording = true
    const tl: number[] = [] // seconds since the start
    const tp: number[] = [] // song position (ms) at that time
    const startPos = getPosition()
    const trackId = track.id
    let lastLine = -1
    let lastSync = 0
    let lastReport = 0
    let stalled = 0
    let done = false
    let clock: Worker | null = null
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (done) return
        const nowMs = performance.now() - t0
        const secs = nowMs / 1000
        const snap = usePlayer.getState().snapshot
        const pos = getPosition()
        const over = aborted || secs >= planned || snap?.track?.id !== trackId || pos >= endMs || (secs > 3 && pos < startPos - 2000 && startMs === 0) || (secs > 3 && pos < startMs - 2000)
        if (snap && !snap.isPlaying) stalled += 1
        else stalled = 0
        if (over || stalled > 400) {
          done = true
          clock?.terminate()
          return resolve()
        }
        if (nowMs - lastLine >= 100) {
          lastLine = nowMs
          tl.push(secs)
          tp.push(pos)
        }
        if (opts.youtube && nowMs - lastSync > 1500) {
          lastSync = nowMs
          void window.lyra.studio.stageSync(pos / 1000)
        }
        if (nowMs - lastReport > 500) {
          lastReport = nowMs
          onProgress({ stage: 'recording', seconds: secs, total: planned })
        }
      }
      // paced by a worker's clock: it keeps ticking when the window is covered or minimized
      clock = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' })
      clock.onmessage = tick
    })
    ;(clock as Worker | null)?.terminate()
    recording = false
    running = false
    offAudio?.()
    void window.lyra.studio.audioStop()
    audioTrack?.stop()
    try {
      await reader?.cancel()
    } catch {
      /* already closed */
    }
    await pump.catch(() => undefined)
    const frameTimes = opts.youtube ? await window.lyra.studio.frameCaptureStop() : null
    void window.lyra.studio.stageStop()
    if (aborted) throw new Error('cancelled')

    // ---------- the recorded sound as two long arrays
    if (stored < sampleRate) throw new Error('No sound was recorded. Make sure the song is playing out loud on this PC.')
    const L = new Float32Array(stored)
    const R = new Float32Array(stored)
    for (let off = 0, i = 0; i < left.length; off += left[i]!.length, i++) {
      L.set(left[i]!, off)
      R.set(right[i]!, off)
    }
    left.length = 0
    right.length = 0
    const audioSecs = stored / sampleRate
    const frames = Math.round(audioSecs * FPS)

    // ---------- step 2: render
    onProgress({ stage: 'rendering', seconds: 0, total: audioSecs })
    const css = getComputedStyle(document.documentElement)
    let crop = opts.youtube?.crop ?? null
    const offStage = opts.youtube ? { bitmap: null as ImageBitmap | null, crop } : null
    const scene = createScene({
      stage: offStage,
      w,
      h,
      lines,
      title: track.title,
      artist: track.artists.join(', '),
      art,
      media,
      logo,
      accent: css.getPropertyValue('--accent').trim() || '#d8d8d8',
      tint1: css.getPropertyValue('--tint1').trim() || '#1a1a1a',
      tint2: css.getPropertyValue('--tint2').trim() || '#101010',
      showSong: opts.showSong,
      totalMs: audioSecs * 1000,
      ...lookInputs(opts.look, css.getPropertyValue('--accent').trim() || '#ffffff')
    })
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { alpha: false })!

    const vcfg = await pickEncoder(encoderConfig(w, h, opts.quality, FPS))
    const muxer = new Muxer({
      target: new StreamTarget({ onData: (chunk: Uint8Array, position: number) => void window.lyra.studio.write(file.id, position, chunk.slice()) }),
      video: { codec: 'avc', width: w, height: h, frameRate: FPS },
      audio: { codec: 'aac', numberOfChannels: 2, sampleRate },
      fastStart: false,
      firstTimestampBehavior: 'offset'
    })
    let encError: Error | null = null
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encError = e) })
    venc.configure(vcfg)
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (encError = e) })
    aenc.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192_000 })

    // the sound: exact, with a short fade at both ends, brought to about -14 LUFS with a soft ceiling
    const gain = loudnessGainOf([L, R], 0, stored)
    const block = 4800
    const fadeIn = Math.round(sampleRate * 0.08)
    const fadeOut = Math.round(sampleRate * 0.3)
    for (let s = 0; s < stored && !aborted && !encError; s += block) {
      const n = Math.min(block, stored - s)
      const data = new Float32Array(n * 2)
      for (let i = 0; i < n; i++) {
        const idx = s + i
        const g = Math.max(0, Math.min(1, idx / fadeIn, (stored - idx) / fadeOut))
        data[i] = softCeiling(L[idx]! * gain) * g
        data[n + i] = softCeiling(R[idx]! * gain) * g
      }
      const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((s / sampleRate) * 1e6), data })
      aenc.encode(ad)
      ad.close()
      while (aenc.encodeQueueSize > 30) await new Promise((r) => setTimeout(r, 4))
    }

    // pictures
    const posAt = (t: number): number => {
      if (!tl.length) return startMs + t * 1000
      let lo = 0
      let hi = tl.length - 1
      if (t <= tl[0]!) return tp[0]!
      if (t >= tl[hi]!) return tp[hi]! + (t - tl[hi]!) * 1000
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (tl[mid]! <= t) lo = mid
        else hi = mid
      }
      const k = (t - tl[lo]!) / Math.max(1e-6, tl[hi]! - tl[lo]!)
      return tp[lo]! + (tp[hi]! - tp[lo]!) * k
    }
    const bitmapOf = (i: number): Promise<ImageBitmap | null> => {
      let p = bitmaps.get(i)
      if (!p) {
        p = window.lyra.studio
          .frameRead(i)
          .then((b) => (b ? createImageBitmap(new Blob([b as BlobPart], { type: 'image/jpeg' })) : null))
          .catch(() => null)
        bitmaps.set(i, p)
      }
      return p
    }
    let pic = -1 // the background picture index on screen now
    let barsChecked = false
    let cover: Promise<Blob | null> | null = null
    const coverAt = Math.round(frames * 0.33)

    for (let f = 0; f < frames && !aborted && !encError; f++) {
      const t = f / FPS
      if (offStage && frameTimes && frameTimes.length) {
        // the newest picture that had arrived by now
        let lo = Math.max(0, pic)
        while (lo + 1 < frameTimes.length && frameTimes[lo + 1]! <= t * 1000) lo++
        if (lo !== pic) {
          const next = await bitmapOf(lo)
          for (const k of [lo + 1, lo + 2, lo + 3]) if (k < frameTimes.length) void bitmapOf(k)
          for (const [k, p] of bitmaps) {
            if (k < lo - 1) {
              bitmaps.delete(k)
              void p.then((b) => b?.close())
            }
          }
          if (next) {
            if (!barsChecked) {
              barsChecked = true
              const seen = detectBars(next)
              const c = crop ?? { t: 0, r: 0, b: 0, l: 0 }
              crop = { t: Math.max(c.t, seen.t), r: Math.max(c.r, seen.r), b: Math.max(c.b, seen.b), l: Math.max(c.l, seen.l) }
              offStage.crop = crop
            }
            offStage.bitmap = next
          }
          pic = lo
        }
      }
      if (mediaVideo && mediaVideo.duration) await seekVideo(mediaVideo, t % mediaVideo.duration)
      scene.draw(ctx, posAt(t) + offsetNow(), t)
      if (f === coverAt && !cover) cover = new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.93))
      const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) })
      venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 })
      vf.close()
      while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4))
      if (f % 15 === 0) {
        onProgress({ stage: 'rendering', seconds: t, total: audioSecs })
        await new Promise((r) => setTimeout(r, 0)) // let the window breathe
      }
    }
    if (!aborted && !encError) {
      const n = Math.round(END_SECONDS * FPS)
      for (let i = 0; i < n; i++) {
        scene.endCard(ctx, (i + 1) / n, audioSecs + i / FPS)
        const vf = new VideoFrame(canvas, { timestamp: Math.round((audioSecs + i / FPS) * 1e6) })
        venc.encode(vf, { keyFrame: i === 0 })
        vf.close()
        while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4))
      }
    }
    onProgress({ stage: 'finishing', seconds: audioSecs, total: audioSecs })
    if (encError) throw encError as Error
    await venc.flush()
    await aenc.flush()
    muxer.finalize()
    await window.lyra.studio.close(file.id)
    if (aborted) {
      await window.lyra.studio.discard(file.path)
      throw new Error('cancelled')
    }
    let coverPath: string | null = null
    if (cover) {
      const blob = await (cover as Promise<Blob | null>)
      if (blob) coverPath = await window.lyra.studio.saveImage(file.path, new Uint8Array(await blob.arrayBuffer())).catch(() => null)
    }
    return { path: file.path, seconds: audioSecs, droppedPct: 0, fps: FPS, sourceQuality, coverPath }
  } catch (e) {
    await window.lyra.studio.close(file.id).catch(() => undefined)
    if ((e as Error).message === 'cancelled') await window.lyra.studio.discard(file.path).catch(() => undefined)
    throw e
  } finally {
    signal.removeEventListener('abort', abort)
    capture?.getTracks().forEach((t) => t.stop())
    void window.lyra.studio.audioStop()
    void window.lyra.studio.stageStop()
    for (const p of bitmaps.values()) void p.then((b) => b?.close())
    bitmaps.clear()
    await window.lyra.studio.end() // also deletes the temporary pictures
    useBgState.getState().setExporting(false)
  }
}
