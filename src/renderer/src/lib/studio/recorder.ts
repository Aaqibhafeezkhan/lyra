import { Muxer, StreamTarget } from 'mp4-muxer'
import type { LyricLine, Track } from '@shared/types'
import { estimateWords } from '@shared/wordTiming'
import { getPosition, usePlayer } from '@/store/player'
import { useLyrics } from '@/store/lyrics'
import { useOffsets } from '@/store/offsets'
import { useSettings } from '@/store/settings'
import logoUrl from '@/assets/logo.png'
import { createScene } from './scene'
import { StageSource } from './stage'

export type Ratio = '9:16' | '4:5' | '1:1' | '16:9'
export type Quality = '720p' | '1080p' | '1440p'
export type LayoutStyle = 'scroll' | 'focus' | 'subtitle'
export type FontChoice = 'sans' | 'serif' | 'rounded' | 'mono'
export type Highlight = 'white' | 'accent' | 'gold'
export type TextPosition = 'upper' | 'middle' | 'lower'

/** How the text looks: shared by the preview and both exporters. */
export interface Look {
  style: LayoutStyle
  font: FontChoice
  highlight: Highlight
  position: TextPosition
}

const FONT_STACKS: Record<FontChoice, string> = {
  sans: "'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "'Nunito', 'Segoe UI Variable Display', ui-rounded, system-ui, sans-serif",
  mono: "Consolas, 'Courier New', monospace"
}

/** The scene settings that come from a Look (and the cover's colours). */
export function lookInputs(look: Look, accent: string): { style: LayoutStyle; fill: string; position: TextPosition; fontFamily: string } {
  return { style: look.style, position: look.position, fontFamily: FONT_STACKS[look.font], fill: look.highlight === 'white' ? '#ffffff' : look.highlight === 'gold' ? '#ffd166' : accent }
}

export interface ExportOptions {
  look: Look
  ratio: Ratio
  quality: Quality
  /** the part of the song to record */
  startMs: number
  endMs: number
  showSong: boolean
  /** a video or photo picked by the user, or null for the cover's colours */
  mediaUrl: string | null
  mediaKind: 'video' | 'image' | null
  /** a free-to-read 30 s clip to loop behind the lyrics (from the background resolver) */
  clipUrl: string | null
  /** a YouTube video to play behind the lyrics */
  youtube: { videoId: string; crop: { t: number; r: number; b: number; l: number } | null } | null
}

export interface Progress {
  stage: 'preparing' | 'recording' | 'finishing'
  seconds: number
  total: number
}

const RATIOS: Record<Ratio, [number, number]> = { '9:16': [9, 16], '4:5': [4, 5], '1:1': [1, 1], '16:9': [16, 9] }
const SHORT_SIDE: Record<Quality, number> = { '720p': 720, '1080p': 1080, '1440p': 1440 }
const BITRATE: Record<Quality, number> = { '720p': 5_000_000, '1080p': 9_000_000, '1440p': 16_000_000 }
const FPS = 30
const END_SECONDS = 2.8

export function dimensions(ratio: Ratio, quality: Quality): { w: number; h: number } {
  const [rw, rh] = RATIOS[ratio]
  const s = SHORT_SIDE[quality]
  const even = (n: number): number => Math.round(n / 2) * 2
  return rw <= rh ? { w: even(s), h: even((s * rh) / rw) } : { w: even((s * rw) / rh), h: even(s) }
}

export function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const i = new Image()
    i.crossOrigin = 'anonymous' // otherwise the canvas becomes unreadable and no video frame can be made
    i.onload = () => resolve(i)
    i.onerror = () => resolve(null)
    i.src = src
  })
}

export function loadVideo(src: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.loop = true
    v.playsInline = true
    v.onloadeddata = () => resolve(v)
    v.onerror = () => resolve(null)
    v.src = src
    void v.play().catch(() => undefined)
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Records the song as it plays: restarts it from the beginning, captures the PC's sound (loopback) and paints a
 * lyric video frame by frame, then writes an MP4 straight to the chosen file. Real time: a 4-minute song takes
 * 4 minutes. Resolves with the saved path.
 */
export async function exportVideo(opts: ExportOptions, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<{ path: string; seconds: number }> {
  const player = usePlayer.getState()
  const track: Track | undefined = player.snapshot?.track ?? undefined
  if (!track) throw new Error('Play a song first.')
  const lyrics = useLyrics.getState().state
  const lines: LyricLine[] = lyrics.phase === 'ready' && lyrics.result.status === 'synced' ? estimateWords(lyrics.result.lines, track.durationMs) : []
  const { w, h } = dimensions(opts.ratio, opts.quality)

  if (typeof VideoEncoder === 'undefined') throw new Error('This computer can not encode video here.')
  const vcfg: VideoEncoderConfig = { codec: 'avc1.640032', width: w, height: h, bitrate: BITRATE[opts.quality], framerate: FPS, latencyMode: 'realtime' }
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error(`This PC can not encode ${w}×${h} video. Try a lower quality.`)

  onProgress({ stage: 'preparing', seconds: 0, total: 0 })
  const startMs = Math.max(0, Math.min(opts.startMs, track.durationMs - 1000))
  const endMs = Math.min(track.durationMs, Math.max(opts.endMs, startMs + 1000))
  const total = (endMs - startMs) / 1000
  const safeName = `${track.title} - ${track.artists[0] ?? ''}`.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'lyra-video'
  const file = await window.lyra.studio.open(`${safeName} (${opts.ratio.replace(':', 'x')} ${opts.quality}).mp4`)
  if (!file) throw new Error('cancelled')

  let capture: MediaStream | null = null
  let stageRef: StageSource | null = null
  let aborted = false
  const abort = (): void => {
    aborted = true
  }
  signal.addEventListener('abort', abort)
  try {
    // pictures and video first, so the first frame already has them
    const art = await loadImage(track.artworkUrl)
    const logo = await loadImage(logoUrl)
    let media: HTMLVideoElement | HTMLImageElement | null = null
    if (opts.mediaUrl && opts.mediaKind === 'video') media = await loadVideo(opts.mediaUrl)
    else if (opts.mediaUrl && opts.mediaKind === 'image') media = await loadImage(opts.mediaUrl)
    else if (opts.clipUrl) media = await loadVideo(opts.clipUrl)
    // a YouTube background plays in a hidden window; its frames arrive here
    let stage: StageSource | null = null
    if (opts.youtube) {
      stage = stageRef = new StageSource(opts.youtube.crop)
      const st = await window.lyra.studio.stageStart({ videoId: opts.youtube.videoId, width: opts.quality === '720p' ? 1280 : 1920, height: opts.quality === '720p' ? 720 : 1080, fps: FPS, startSec: startMs / 1000 })
      if (!st.ok) throw new Error(`The YouTube video can not be used: ${st.reason ?? 'unknown reason'}. Pick Cover colours instead.`)
      await stage.firstFrame()
    }
    const css = getComputedStyle(document.documentElement)
    const scene = createScene({
      stage,
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
      totalMs: total * 1000,
      ...lookInputs(opts.look, css.getPropertyValue('--accent').trim() || '#ffffff')
    })

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { alpha: false })!

    // sound. First choice: only the Spotify app's own sound (notifications and other programs stay out of the video).
    // If that is not possible, the PC's whole sound.
    let audioTrack: MediaStreamTrack | undefined
    let reader: ReadableStreamDefaultReader<AudioData> | null = null
    let sampleRate = 48000
    let channels = 2
    const helper = await window.lyra.studio.audioStart()
    if (!helper.ok) {
      // music, not a call: stereo, and none of the voice clean-up that would squash it
      capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints })
      capture.getVideoTracks().forEach((t) => t.stop())
      audioTrack = capture.getAudioTracks()[0]
      if (!audioTrack) throw new Error('This PC did not provide system sound.')
      reader = new (window as unknown as { MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioData> } }).MediaStreamTrackProcessor({ track: audioTrack }).readable.getReader()
      // the first block of sound tells us the real sample rate and channel count
      const first = await reader.read()
      if (!first.value) throw new Error('No sound arrived from this PC.')
      sampleRate = first.value.sampleRate
      channels = first.value.numberOfChannels
      first.value.close()
    }

    // output file (streamed to disk in pieces: a long video never sits in memory)
    const muxer = new Muxer({
      target: new StreamTarget({ onData: (chunk: Uint8Array, position: number) => void window.lyra.studio.write(file.id, position, chunk.slice()) }),
      video: { codec: 'avc', width: w, height: h, frameRate: FPS },
      audio: { codec: 'aac', numberOfChannels: channels, sampleRate },
      fastStart: false,
      firstTimestampBehavior: 'offset'
    })
    let encError: Error | null = null
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encError = e) })
    venc.configure(vcfg)
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (encError = e) })
    aenc.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 192_000 })

    // audio pump: sound that arrives before recording starts is thrown away
    let audioT0: number | null = null
    let recording = false
    let running = true
    let helperFrames = 0
    let dropped = 0
    let chunks = 0
    const offAudio = helper.ok
      ? window.lyra.studio.onAudio((pcm) => {
          if (!recording) return
          if (aenc.state !== 'configured' || aenc.encodeQueueSize > 40) {
            dropped++
            return
          }
          chunks++
          const frames = Math.floor(pcm.byteLength / 4)
          if (frames === 0) return
          const i16 = new Int16Array(pcm.buffer, pcm.byteOffset, frames * 2)
          const planar = new Float32Array(frames * 2)
          for (let i = 0; i < frames; i++) {
            planar[i] = i16[i * 2]! / 32768
            planar[frames + i] = i16[i * 2 + 1]! / 32768
          }
          // the capture sends nothing while Spotify is silent (quiet intros, gaps): fill those gaps with silence so the
          // sound stays in step with the picture
          const gap = Math.round(((performance.now() - t0) / 1000) * 48000) - (helperFrames + frames)
          if (gap > 2400) {
            for (let left = gap; left > 0; left -= 24000) {
              const n = Math.min(24000, left)
              const silence = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((helperFrames / 48000) * 1e6), data: new Float32Array(n * 2) })
              helperFrames += n
              aenc.encode(silence)
              silence.close()
            }
          }
          // the timestamp counts the samples we actually received, so the sound can not drift against its own length
          const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: frames, numberOfChannels: 2, timestamp: Math.round((helperFrames / 48000) * 1e6), data: planar })
          helperFrames += frames
          aenc.encode(ad)
          ad.close()
        })
      : null
    const pump = (async () => {
      while (running && reader) {
        const { value, done } = await reader.read()
        if (done || !value) break
        if (!recording) {
          value.close()
          continue
        }
        if (audioT0 === null) audioT0 = value.timestamp
        const ad = new AudioData({ format: 'f32-planar', sampleRate: value.sampleRate, numberOfFrames: value.numberOfFrames, numberOfChannels: value.numberOfChannels, timestamp: value.timestamp - audioT0, data: copyAudio(value) })
        value.close()
        if (aenc.state === 'configured' && aenc.encodeQueueSize < 40) aenc.encode(ad)
        ad.close()
      }
    })()

    // restart the song from the top and wait until it really is at the start
    await usePlayer.getState().command({ type: 'seek', positionMs: startMs })
    if (!usePlayer.getState().snapshot?.isPlaying) await usePlayer.getState().command({ type: 'play' })
    for (let i = 0; i < 40 && Math.abs(getPosition() - startMs) > 1500; i++) await sleep(150)
    if (Math.abs(getPosition() - startMs) > 3000) throw new Error('Could not jump to the start of the part. Press play and try again.')

    // video frames, paced by the clock
    const t0 = performance.now()
    recording = true
    let nextFrame = 0
    let lastReport = 0
    let lastSync = 0
    const startPos = getPosition()
    const trackId = track.id
    let stalled = 0
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const nowMs = performance.now() - t0
        const secs = nowMs / 1000
        const snap = usePlayer.getState().snapshot
        const pos = getPosition()
        const over = aborted || encError || secs >= total || snap?.track?.id !== trackId || pos >= endMs || (secs > 3 && pos < startPos - 2000 && startMs === 0) || (secs > 3 && pos < startMs - 2000)
        if (snap && !snap.isPlaying) stalled += 1
        else stalled = 0
        if (over || stalled > 400) return resolve()
        if (nowMs >= nextFrame) {
          nextFrame += 1000 / FPS
          if (nowMs - nextFrame > 500) nextFrame = nowMs // fell far behind: do not try to catch up
          if (venc.encodeQueueSize < 6) {
            try {
              const lyricPos = pos + offsetNow()
              scene.draw(ctx, lyricPos, secs)
              const frame = new VideoFrame(canvas, { timestamp: Math.round(nowMs * 1000) })
              venc.encode(frame, { keyFrame: Math.round(nowMs / (1000 / FPS)) % (FPS * 2) === 0 })
              frame.close()
            } catch (e) {
              encError = e as Error
              return resolve()
            }
          }
          if (stage && nowMs - lastSync > 1500) {
            lastSync = nowMs
            void window.lyra.studio.stageSync(pos / 1000)
          }
          if (nowMs - lastReport > 500) {
            lastReport = nowMs
            onProgress({ stage: 'recording', seconds: secs, total })
          }
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    recording = false
    running = false
    onProgress({ stage: 'finishing', seconds: total, total })
    // closing card: a few seconds of black with the logo and "Download Lyra" (encoded faster than real time)
    if (!aborted && !encError) {
      const baseMs = performance.now() - t0
      const n = Math.round(END_SECONDS * FPS)
      for (let i = 0; i < n; i++) {
        scene.endCard(ctx, (i + 1) / n, baseMs / 1000 + i / FPS)
        const frame = new VideoFrame(canvas, { timestamp: Math.round((baseMs + (i * 1000) / FPS) * 1000) })
        venc.encode(frame, { keyFrame: i === 0 })
        frame.close()
        while (venc.encodeQueueSize > 8) await sleep(8)
      }
    }
    offAudio?.()
    void window.lyra.studio.audioStop()
    audioTrack?.stop()
    try {
      await reader?.cancel()
    } catch {
      /* already closed */
    }
    await pump.catch(() => undefined)
    if (encError) throw encError as Error
    await venc.flush()
    await aenc.flush()
    muxer.finalize()
    const seconds = (performance.now() - t0) / 1000
    await window.lyra.studio.close(file.id)
    if (aborted) {
      await window.lyra.studio.discard(file.path)
      throw new Error('cancelled')
    }
    return { path: file.path, seconds }
  } catch (e) {
    await window.lyra.studio.close(file.id).catch(() => undefined)
    if ((e as Error).message === 'cancelled') await window.lyra.studio.discard(file.path).catch(() => undefined)
    throw e
  } finally {
    signal.removeEventListener('abort', abort)
    capture?.getTracks().forEach((t) => t.stop())
    void window.lyra.studio.audioStop()
    stageRef?.close()
    void window.lyra.studio.stageStop()
    await window.lyra.studio.end()
  }
}

/** The lyric timing offset (global + this song's nudge), read without a hook. */
function offsetNow(): number {
  const id = usePlayer.getState().snapshot?.track?.id
  return useSettings.getState().settings.lyricOffsetMs + (id ? (useOffsets.getState().map[id] ?? 0) : 0)
}

function copyAudio(a: AudioData): BufferSource {
  const planes = a.numberOfChannels
  const frames = a.numberOfFrames
  const out = new Float32Array(frames * planes)
  const fmt = a.format ?? 'f32-planar'
  if (fmt.endsWith('planar')) {
    for (let c = 0; c < planes; c++) {
      const tmp = new Float32Array(frames)
      a.copyTo(tmp, { planeIndex: c, format: 'f32-planar' })
      out.set(tmp, c * frames)
    }
    return out
  }
  a.copyTo(out, { planeIndex: 0, format: 'f32' })
  // interleaved -> planar for the encoder input we declare below
  const planar = new Float32Array(frames * planes)
  for (let i = 0; i < frames; i++) for (let c = 0; c < planes; c++) planar[c * frames + i] = out[i * planes + c]!
  return planar
}
