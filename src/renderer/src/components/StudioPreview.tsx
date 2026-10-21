import { useEffect, useRef } from 'react'
import type { LyricLine, Track } from '@shared/types'
import logoUrl from '@/assets/logo.png'
import { dimensions, loadImage, loadVideo, lookInputs, type Look, type Ratio } from '@/lib/studio/recorder'
import { createScene } from '@/lib/studio/scene'
import type { StageSource } from '@/lib/studio/stage'

interface Props {
  track: Track
  lines: LyricLine[]
  ratio: Ratio
  look: Look
  showSong: boolean
  /** a looping video or photo behind the lyrics, or null for the cover's colours */
  media: { url: string; kind: 'video' | 'image' } | null
  /** a YouTube video playing in the hidden window */
  stage: StageSource | null
  startMs: number
  endMs: number
}

/** A small live preview of the finished video: the same drawing code the export uses, looping over the chosen part. */
export function StudioPreview({ track, lines, ratio, look, showSong, media, stage, startMs, endMs }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { w, h } = dimensions(ratio, '720p')
  const pw = Math.round(w / 2)
  const ph = Math.round(h / 2)

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    cv.width = pw
    cv.height = ph
    const ctx = cv.getContext('2d', { alpha: false })!
    let stop = false
    let raf = 0
    let video: HTMLVideoElement | null = null
    const begin = (art: HTMLImageElement | null, logo: HTMLImageElement | null, m: HTMLVideoElement | HTMLImageElement | null): void => {
      cancelAnimationFrame(raf)
      const css = getComputedStyle(document.documentElement)
      const scene = createScene({
        w: pw,
        h: ph,
        lines,
        title: track.title,
        artist: track.artists.join(', '),
        art,
        stage,
        media: m,
        logo,
        accent: css.getPropertyValue('--accent').trim() || '#d8d8d8',
        tint1: css.getPropertyValue('--tint1').trim() || '#1a1a1a',
        tint2: css.getPropertyValue('--tint2').trim() || '#101010',
        showSong,
        totalMs: endMs - startMs,
        ...lookInputs(look, css.getPropertyValue('--accent').trim() || '#ffffff')
      })
      const span = Math.max(1000, Math.min(endMs - startMs, 14_000))
      const t0 = performance.now()
      const tick = (): void => {
        if (stop) return
        const el = performance.now() - t0
        scene.draw(ctx, startMs + (el % span), el / 1000)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    void (async () => {
      const [art, logo] = await Promise.all([loadImage(track.artworkUrl), loadImage(logoUrl)])
      if (stop) return
      begin(art, logo, null) // show something straight away; the video joins in when it has loaded
      let m: HTMLVideoElement | HTMLImageElement | null = null
      if (media?.kind === 'video') m = video = await loadVideo(media.url)
      else if (media?.kind === 'image') m = await loadImage(media.url)
      if (!stop && m) begin(art, logo, m)
    })()
    return () => {
      stop = true
      cancelAnimationFrame(raf)
      video?.pause()
    }
  }, [track, lines, pw, ph, showSong, media, stage, startMs, endMs, look])

  return <canvas ref={canvas} className="studio__preview" style={{ aspectRatio: `${pw} / ${ph}` }} aria-label="Preview of the video" />
}
