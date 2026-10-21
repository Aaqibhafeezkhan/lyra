import { Muxer, StreamTarget } from 'mp4-muxer'
import type { LyricLine, Track } from '@shared/types'
import { estimateWords } from '@shared/wordTiming'
import { getPosition, usePlayer } from '@/store/player'
import { useLyrics } from '@/store/lyrics'
import { useOffsets } from '@/store/offsets'
import { useSettings } from '@/store/settings'
import logoUrl from '@/assets/logo.png'
import { createScene } from './scene'

export type Ratio = '9:16' | '4:5' | '1:1' | '16:9'
export type Quality = '720p' | '1080p' | '1440p'
export interface ExportOptions {
  ratio: Ratio
  quality: Quality
  /** 0 = the whole song, otherwise stop after this many seconds (a quick test) */
  maxSeconds: number
  showSong: boolean
  /** a video or photo picked by the user, or null for the cover's colours */
  mediaUrl: string | null
  mediaKind: 'video' | 'image' | null
  /** a free-to-read 30 s clip to loop behind the lyrics (from the background resolver) */
  clipUrl: string | null
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

function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const i = new Image()
    i.crossOrigin = 'anonymous' // otherwise the canvas becomes unreadable and no video frame can be made
    i.onload = () => resolve(i)
    i.onerror = () => resolve(null)
    i.src = src
  })
}

function loadVideo(src: string): Promise<HTMLVideoElement | null> {
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
  const total = opts.maxSeconds > 0 ? Math.min(opts.maxSeconds, track.durationMs / 1000) : track.durationMs / 1000
  const safeName = `${track.title} - ${track.artists[0] ?? ''}`.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'lyra-video'
  const file = await window.lyra.studio.open(`${safeName} (${opts.ratio.replace(':', 'x')} ${opts.quality}).mp4`)
  if (!file) throw new Error('cancelled')

  let capture: MediaStream | null = null
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
    const css = getComputedStyle(document.documentElement)
    const scene = createScene({
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
      fontFamily: getComputedStyle(document.body).fontFamily || 'Inter, system-ui, sans-serif'
    })

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { alpha: false })!

    // the PC's own sound
    // music, not a call: stereo, and none of the voice clean-up that would squash it
    capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints })
    capture.getVideoTracks().forEach((t) => t.stop())
    const audioTrack = capture.getAudioTracks()[0]
    if (!audioTrack) throw new Error('This PC did not provide system sound.')
    const reader = new (window as unknown as { MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioData> } }).MediaStreamTrackProcessor({ track: audioTrack }).readable.getReader()
    // the first block of sound tells us the real sample rate and channel count
    const first = await reader.read()
    if (!first.value) throw new Error('No sound arrived from this PC.')
    const sampleRate = first.value.sampleRate
    const channels = first.value.numberOfChannels
    first.value.close()

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
    const pump = (async () => {
      while (running) {
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
    await usePlayer.getState().command({ type: 'seek', positionMs: 0 })
    if (!usePlayer.getState().snapshot?.isPlaying) await usePlayer.getState().command({ type: 'play' })
    for (let i = 0; i < 40 && getPosition() > 1500; i++) await sleep(150)
    if (getPosition() > 3000) throw new Error('Could not restart the song. Press play from the start and try again.')

    // video frames, paced by the clock
    const t0 = performance.now()
    recording = true
    let nextFrame = 0
    let lastReport = 0
    const startPos = getPosition()
    const trackId = track.id
    let stalled = 0
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const nowMs = performance.now() - t0
        const secs = nowMs / 1000
        const snap = usePlayer.getState().snapshot
        const pos = getPosition()
        const over = aborted || encError || secs >= total || snap?.track?.id !== trackId || pos >= track.durationMs - 150 || (secs > 3 && pos < startPos - 2000)
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
    audioTrack.stop()
    try {
      await reader.cancel()
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
