import { Muxer, StreamTarget } from 'mp4-muxer'
import type { LyricLine } from '@shared/types'
import { estimateWords } from '@shared/wordTiming'
import logoUrl from '@/assets/logo.png'
import { dimensions, loadImage, loadVideo, lookInputs, type Look, type Quality, type Ratio, type Progress } from './recorder'
import { createScene } from './scene'

/**
 * Make a lyric video from an audio file you own (a singer's own song, a cover): no recording, no real time.
 * The file is decoded, the picture is drawn frame by frame from the lyric timing and everything is encoded as fast
 * as the computer allows, so you can keep working (or play other songs) meanwhile.
 */
export interface FileExportOptions {
  audio: ArrayBuffer
  title: string
  artist: string
  lines: LyricLine[]
  coverUrl: string | null
  ratio: Ratio
  quality: Quality
  look: Look
  showSong: boolean
  startMs: number
  endMs: number
  mediaUrl: string | null
  mediaKind: 'video' | 'image' | null
}

const BITRATE: Record<Quality, number> = { '720p': 5_000_000, '1080p': 9_000_000, '1440p': 16_000_000 }
const FPS = 30
const END_SECONDS = 2.8

export async function decodeAudio(buf: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext({ sampleRate: 48000 })
  try {
    return await ctx.decodeAudioData(buf.slice(0))
  } finally {
    void ctx.close()
  }
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001) return resolve()
    const done = (): void => {
      v.removeEventListener('seeked', done)
      resolve()
    }
    v.addEventListener('seeked', done)
    v.currentTime = t
    setTimeout(done, 1500)
  })
}

export async function exportFromFile(opts: FileExportOptions, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<{ path: string }> {
  const { w, h } = dimensions(opts.ratio, opts.quality)
  const vcfg: VideoEncoderConfig = { codec: 'avc1.640032', width: w, height: h, bitrate: BITRATE[opts.quality], framerate: FPS }
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error(`This PC can not encode ${w}×${h} video. Try a lower quality.`)
  onProgress({ stage: 'preparing', seconds: 0, total: 0 })

  const pcm = await decodeAudio(opts.audio)
  const startMs = Math.max(0, opts.startMs)
  const endMs = Math.min(pcm.duration * 1000, Math.max(opts.endMs, startMs + 1000))
  const total = (endMs - startMs) / 1000
  const safe = `${opts.title} - ${opts.artist}`.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'lyra-video'
  const file = await window.lyra.studio.open(`${safe} (${opts.ratio.replace(':', 'x')} ${opts.quality}).mp4`)
  if (!file) throw new Error('cancelled')

  let aborted = false
  const onAbort = (): void => {
    aborted = true
  }
  signal.addEventListener('abort', onAbort)
  try {
    const art = await loadImage(opts.coverUrl)
    const logo = await loadImage(logoUrl)
    let media: HTMLVideoElement | HTMLImageElement | null = null
    let video: HTMLVideoElement | null = null
    if (opts.mediaUrl && opts.mediaKind === 'video') media = video = await loadVideo(opts.mediaUrl)
    else if (opts.mediaUrl && opts.mediaKind === 'image') media = await loadImage(opts.mediaUrl)
    video?.pause()
    const css = getComputedStyle(document.documentElement)
    const lines = estimateWords(opts.lines, pcm.duration * 1000)
    const scene = createScene({
      w,
      h,
      lines,
      title: opts.title,
      artist: opts.artist,
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

    const channels = Math.min(2, pcm.numberOfChannels)
    const muxer = new Muxer({
      target: new StreamTarget({ onData: (chunk: Uint8Array, position: number) => void window.lyra.studio.write(file.id, position, chunk.slice()) }),
      video: { codec: 'avc', width: w, height: h, frameRate: FPS },
      audio: { codec: 'aac', numberOfChannels: channels, sampleRate: 48000 },
      fastStart: false,
      firstTimestampBehavior: 'offset'
    })
    let encError: Error | null = null
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encError = e) })
    venc.configure(vcfg)
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (encError = e) })
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: channels, bitrate: 192_000 })

    // sound: the chosen part, cut into small blocks (with a short fade at both ends)
    const s0 = Math.floor((startMs / 1000) * 48000)
    const s1 = Math.floor((endMs / 1000) * 48000)
    const block = 4800
    const fade = 14400
    for (let s = s0; s < s1 && !aborted; s += block) {
      const n = Math.min(block, s1 - s)
      const data = new Float32Array(n * channels)
      for (let c = 0; c < channels; c++) {
        const src = pcm.getChannelData(c)
        for (let i = 0; i < n; i++) {
          const idx = s + i
          const g = Math.min(1, (idx - s0) / fade, (s1 - idx) / fade)
          data[c * n + i] = src[idx]! * Math.max(0, g)
        }
      }
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round(((s - s0) / 48000) * 1e6), data })
      aenc.encode(ad)
      ad.close()
      while (aenc.encodeQueueSize > 30) await new Promise((r) => setTimeout(r, 4))
    }

    // pictures: one per frame, as fast as the encoder takes them
    const frames = Math.round(total * FPS)
    const started = performance.now()
    for (let f = 0; f < frames && !aborted && !encError; f++) {
      const t = f / FPS
      if (video && video.duration) await seekVideo(video, t % video.duration)
      scene.draw(ctx, startMs + t * 1000, t)
      const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) })
      venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 })
      vf.close()
      while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4))
      if (f % 15 === 0) {
        onProgress({ stage: 'recording', seconds: t, total })
        await new Promise((r) => setTimeout(r, 0)) // let the window breathe
      }
    }
    if (!aborted && !encError) {
      const n = Math.round(END_SECONDS * FPS)
      for (let i = 0; i < n; i++) {
        scene.endCard(ctx, (i + 1) / n, total + i / FPS)
        const vf = new VideoFrame(canvas, { timestamp: Math.round((total + i / FPS) * 1e6) })
        venc.encode(vf, { keyFrame: i === 0 })
        vf.close()
        while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4))
      }
    }
    onProgress({ stage: 'finishing', seconds: total, total })
    if (encError) throw encError as Error
    await venc.flush()
    await aenc.flush()
    muxer.finalize()
    await window.lyra.studio.close(file.id)
    void started
    if (aborted) {
      await window.lyra.studio.discard(file.path)
      throw new Error('cancelled')
    }
    return { path: file.path }
  } catch (e) {
    await window.lyra.studio.close(file.id).catch(() => undefined)
    if ((e as Error).message === 'cancelled') await window.lyra.studio.discard(file.path).catch(() => undefined)
    throw e
  } finally {
    signal.removeEventListener('abort', onAbort)
    await window.lyra.studio.end()
  }
}
