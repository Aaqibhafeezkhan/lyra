import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { BackgroundSpec } from '@shared/types'
import { useArtwork } from '@/hooks/useArtwork'
import { useBackground } from '@/hooks/useBackground'
import { useReducedMotion } from '@/hooks/useMotion'
import { getPosition, usePlayer } from '@/store/player'
import { useBgState } from '@/store/bgState'
import { useSettings } from '@/store/settings'

/** True while the window is actually on screen (not minimised / fully covered). */
function usePageVisible(): boolean {
  const [v, setV] = useState(!document.hidden)
  useEffect(() => {
    const on = (): void => setV(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return v
}

interface Crop {
  t: number
  r: number
  b: number
  l: number
}
const NO_CROP: Crop = { t: 0, r: 0, b: 0, l: 0 }
const MAX_BAR = 0.3

/**
 * Samples the playing video a few times a second (tiny canvas) to learn
 *  - how bright it is (drives the auto-dim), and
 *  - whether the clip itself has black letterbox / pillarbox bars (they get cropped away).
 * Bars must persist across several samples, so a genuinely dark scene is never mistaken for one.
 */
function useFrameStats(video: MutableRefObject<HTMLVideoElement | null>, active: boolean, resetKey: string): { luma: number; crop: Crop } {
  const [stats, setStats] = useState({ luma: 0.35, crop: NO_CROP })
  useEffect(() => {
    setStats({ luma: 0.35, crop: NO_CROP })
    if (!active) return
    const W = 64
    const H = 36
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const history: Crop[] = []
    let luma = 0.35
    let dead = false
    const tick = (): void => {
      const v = video.current
      if (dead || !v || v.readyState < 2 || v.paused) return
      let data: Uint8ClampedArray
      try {
        ctx.drawImage(v, 0, 0, W, H)
        data = ctx.getImageData(0, 0, W, H).data
      } catch {
        dead = true // tainted: no sampling for this source
        return
      }
      const lum = (x: number, y: number): number => {
        const i = (y * W + x) * 4
        return (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
      }
      const rowDark = (y: number): boolean => {
        let sum = 0
        let max = 0
        for (let x = 0; x < W; x++) {
          const l = lum(x, y)
          sum += l
          if (l > max) max = l
        }
        return sum / W < 0.045 && max < 0.14
      }
      const colDark = (x: number): boolean => {
        let sum = 0
        let max = 0
        for (let y = 0; y < H; y++) {
          const l = lum(x, y)
          sum += l
          if (l > max) max = l
        }
        return sum / H < 0.045 && max < 0.14
      }
      let t = 0
      while (t < H * MAX_BAR && rowDark(t)) t++
      let b = 0
      while (b < H * MAX_BAR && rowDark(H - 1 - b)) b++
      let l = 0
      while (l < W * MAX_BAR && colDark(l)) l++
      let r = 0
      while (r < W * MAX_BAR && colDark(W - 1 - r)) r++
      history.push({ t: t / H, b: b / H, l: l / W, r: r / W })
      if (history.length > 5) history.shift()
      // a bar only counts if it was there in every recent sample
      const agreed: Crop = {
        t: Math.min(...history.map((h) => h.t)),
        b: Math.min(...history.map((h) => h.b)),
        l: Math.min(...history.map((h) => h.l)),
        r: Math.min(...history.map((h) => h.r))
      }
      // brightness of the visible part only
      let sum = 0
      let n = 0
      for (let y = t; y < H - b; y += 2) for (let x = l; x < W - r; x += 2) (sum += lum(x, y)), n++
      if (n) luma = luma * 0.6 + (sum / n) * 0.4
      setStats((s) => {
        const same = (['t', 'b', 'l', 'r'] as const).every((k) => Math.abs(s.crop[k] - agreed[k]) < 0.012)
        return { luma: Math.round(luma * 100) / 100, crop: history.length >= 3 && !same ? agreed : s.crop }
      })
    }
    const id = window.setInterval(tick, 650)
    return () => {
      dead = true
      window.clearInterval(id)
    }
  }, [video, active, resetKey])
  return stats
}

/** Two stacked copies of the clip that cross-fade into each other, so a short clip loops without a visible jump. */
function LoopVideo({ url, run, crop, videoRef, onFail }: { url: string; run: boolean; crop: Crop; videoRef: MutableRefObject<HTMLVideoElement | null>; onFail: () => void }) {
  const refA = useRef<HTMLVideoElement>(null)
  const refB = useRef<HTMLVideoElement>(null)
  const els = [refA, refB] as const
  const [front, setFront] = useState<0 | 1>(0)
  const frontRef = useRef<0 | 1>(0)
  const swapping = useRef(false)
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    videoRef.current = els[front]!.current
  }, [front, videoRef]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cur = els[frontRef.current]!.current
    if (run) void cur?.play().catch(() => undefined)
    else els.forEach((e) => e.current?.pause())
  }, [run]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = els[frontRef.current]!.current
      const next = els[1 - frontRef.current]!.current
      if (!cur || !next || swapping.current || !runRef.current) return
      if (cur.duration > 4 && cur.duration - cur.currentTime < 1.3) {
        swapping.current = true
        next.currentTime = 0
        void next.play().catch(() => undefined)
        const old = frontRef.current
        frontRef.current = (1 - old) as 0 | 1
        setFront(frontRef.current)
        window.setTimeout(() => {
          els[old]!.current?.pause()
          swapping.current = false
        }, 1500)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const view = `inset(${crop.t * 100}% ${crop.r * 100}% ${crop.b * 100}% ${crop.l * 100}%)`
  const common = {
    className: 'backdrop__media',
    src: url,
    muted: true,
    playsInline: true,
    preload: 'auto' as const,
    crossOrigin: 'anonymous' as const,
    disablePictureInPicture: true,
    onError: onFail
  }
  return (
    <>
      {[0, 1].map((i) => (
        <video
          key={i}
          ref={els[i]!}
          {...common}
          autoPlay={i === 0}
          style={{ opacity: front === i ? 1 : 0, ['objectViewBox' as string]: view }}
          onLoadedMetadata={(e) => {
            // very short clips just loop natively
            if (i === 0 && e.currentTarget.duration <= 4) e.currentTarget.loop = true
          }}
        />
      ))}
    </>
  )
}

function ImageLayer({ url, onFail }: { url: string; onFail: () => void }) {
  return <img className="backdrop__media" src={url} alt="" draggable={false} onError={onFail} />
}

function phoneInit(): boolean {
  return document.documentElement.dataset.platform === 'android'
}

function YoutubeLayer({ spec, run, onFail }: { spec: Extract<BackgroundSpec, { kind: 'youtube' }>; run: boolean; onFail: (why?: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [xf, setXf] = useState('translate(-50%, -50%) scale(1)')
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const timer = useRef(0)
  /** On the phone the muted video is never paused: pausing and resuming makes YouTube re-buffer and flash its own controls. */
  const phone = document.documentElement.dataset.platform === 'android'
  const lastState = useRef(-1)
  // YouTube flashes its own controls for a few seconds after it starts and after the app is reopened: keep it invisible then
  const [masked, setMasked] = useState(phoneInit())
  const maskTimer = useRef(0)
  const holdMask = (ms = 4000, always = false): void => {
    if (!phone && !always) return
    setMasked(true)
    window.clearTimeout(maskTimer.current)
    maskTimer.current = window.setTimeout(() => setMasked(false), ms)
  }
  const runRef = useRef(run)
  runRef.current = run
  const [start] = useState(() => {
    // join the video roughly where the song is, when the lengths plausibly match
    const pos = getPosition() / 1000
    return spec.durationSec && pos > 3 && pos < spec.durationSec - 8 ? Math.floor(pos) : 0
  })

  const cmd = (func: string, args: unknown[] = []): void =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com')

  // always render the embed at 1080p and scale it down/up to cover, so YouTube serves its best stream even in the small mini player.
  // Ambient mode (dim, soft, on battery) asks for 480p instead: far cheaper to decode and it looks just as good that dim.
  const W = document.documentElement.dataset.ambient === '1' ? 854 : 1920
  const H = document.documentElement.dataset.ambient === '1' ? 480 : 1080
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    // trim the video's own black bars (found from its thumbnail), then scale to cover with a little extra to hide the player's edge UI
    const c = spec.crop ?? { t: 0, r: 0, b: 0, l: 0 }
    const aw = 1 - c.l - c.r
    const ah = 1 - c.t - c.b
    const ro = new ResizeObserver(() => {
      const k = Math.max(el.clientWidth / (W * aw), el.clientHeight / (H * ah)) * 1.1
      const dx = ((c.l - c.r) / 2) * W * k
      const dy = ((c.t - c.b) / 2) * H * k
      setXf(`translate(calc(-50% - ${dx}px), calc(-50% - ${dy}px)) scale(${k})`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [spec.crop])

  useEffect(() => {
    setReady(false)
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow || e.origin !== 'https://www.youtube-nocookie.com') return
      let d: { event?: string; info?: { playerState?: number } } | null = null
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (d?.info?.playerState !== undefined) {
        lastState.current = d.info.playerState
        // playing, paused (we pause it while the song is paused) or cued all mean the player works: no need to give up on it
        if (d.info.playerState === 1 || d.info.playerState === 2 || d.info.playerState === 5) window.clearTimeout(timer.current)
      }
      if (d?.event === 'onError') onFailRef.current(`error ${(d as { info?: unknown }).info ?? ''}`)
      else if (d?.event === 'onReady') {
        cmd('setPlaybackQuality', [document.documentElement.dataset.ambient === '1' ? 'large' : 'hd1080'])
        if (!phone && !runRef.current) cmd('pauseVideo')
      } else if (d?.event === 'infoDelivery' && d.info?.playerState === 1) {
        window.clearTimeout(timer.current)
        setReady((was) => {
          // on the PC too, the first seconds: YouTube shows its own previous / pause / next buttons over a fresh video
          if (!was) holdMask(phone ? 4000 : 6500, true)
          return true
        })
      }
    }
    window.addEventListener('message', onMsg)
    // if it never starts (blocked embed, offline) fall back instead of showing a black box
    timer.current = window.setTimeout(() => onFailRef.current('timeout'), 25_000)
    return () => {
      window.removeEventListener('message', onMsg)
      window.clearTimeout(timer.current)
    }
  }, [spec.videoId])

  useEffect(() => {
    if (!ready) return
    if (phone && run) holdMask()
    if (phone) {
      // only restart it if the system actually stopped it while the app was away
      if (run && lastState.current !== 1) cmd('playVideo')
      return
    }
    cmd(run ? 'playVideo' : 'pauseVideo')
  }, [run, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const src =
    `https://www.youtube-nocookie.com/embed/${spec.videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${spec.videoId}&start=${start}` +
    '&modestbranding=1&playsinline=1&disablekb=1&rel=0&fs=0&iv_load_policy=3&enablejsapi=1&vq=' + (document.documentElement.dataset.ambient === '1' ? 'large' : 'hd1080')
  return (
    <div ref={wrap} className="backdrop__ytwrap">
      <iframe
        ref={frame}
        className="backdrop__yt"
        data-ready={ready || undefined}
      data-mask={masked || undefined}
        style={{ width: W, height: H, transform: xf }}
        src={src}
        title="Background video"
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
        onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube-nocookie.com')}
      />
    </div>
  )
}

/**
 * Artwork-derived atmosphere: a blurred copy of the cover plus two slow colour fields
 * from the palette (set as CSS variables on :root). A dark shade keeps text readable.
 * In the cinematic modes it can be replaced by a looping video / GIF / image (see useBackground).
 */
export function Backdrop({ rich = false, animated = false }: { rich?: boolean; animated?: boolean }) {
  const url = usePlayer((s) => s.snapshot?.track?.artworkUrl ?? null)
  const playing = usePlayer((s) => s.snapshot?.isPlaying ?? false)
  const src = useArtwork(url)
  const dim = useSettings((s) => s.settings.backgroundDim)
  const autoDim = useSettings((s) => s.settings.autoDim)
  const reduced = useReducedMotion()
  const visible = usePageVisible()
  const res = useBackground(animated)
  const [failed, setFailed] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // a YouTube video that can not be played here (embedding blocked, never started) hands over to the Apple clip
  const [ytFailed, setYtFailed] = useState<string | null>(null)
  const [ytWhy, setYtWhy] = useState('')
  // ...but first the next best videos of the song are tried (one that blocks embedding is common, a re-upload often plays)
  const [ytSkip, setYtSkip] = useState(0)
  const tries: BackgroundSpec[] = res?.spec.kind === 'youtube' ? [res.spec, ...(res.alternates ?? [])] : []
  const baseSpec = tries.length ? (tries[ytSkip] ?? tries[tries.length - 1]!) : (res?.spec ?? null)
  useEffect(() => {
    setYtFailed(null)
    setYtSkip(0)
  }, [res])
  const ytDead = baseSpec?.kind === 'youtube' && ytFailed === baseSpec.videoId
  const spec = ytDead && res?.fallback ? res.fallback : baseSpec
  const specKey = spec?.kind === 'youtube' ? `yt:${spec.videoId}` : spec && 'url' in spec ? spec.url : (spec?.kind ?? '')
  useEffect(() => setFailed(null), [specKey])
  const fail = (why?: string): void => {
    if (spec?.kind === 'youtube') {
      console.warn('[background] YouTube video failed:', spec.videoId, why)
      if (ytSkip < tries.length - 1) {
        setYtSkip(ytSkip + 1) // try the next video of this song
        return
      }
      setYtWhy(why ?? '')
      setYtFailed(spec.videoId)
    } else setFailed(specKey)
  }

  const usable = animated && !reduced && !(failed && failed === specKey) && !(ytDead && !res?.fallback)
  const isVideoFile = !!spec && (spec.kind === 'preview' || (spec.kind === 'media' && spec.media === 'video'))
  const isImage = !!spec && spec.kind === 'media' && spec.media === 'image'
  const isYt = spec?.kind === 'youtube'
  const mediaUrl = spec && 'url' in spec ? spec.url : null
  const showMedia = usable && (isVideoFile || isImage)
  const showYt = usable && isYt
  const hasMedia = showMedia || showYt
  const exporting = useBgState((s) => s.exporting)
  const run = visible && playing && !exporting // pause (never unmount) when the window is hidden or the song is paused
  const alive = animated && !reduced && spec?.kind !== 'still'

  const stats = useFrameStats(videoRef, usable && isVideoFile && run, specKey)

  // let the rest of the UI know a video is behind it, so it can switch to glass panels
  useEffect(() => {
    if (hasMedia) document.documentElement.dataset.bgMedia = rich ? 'full' : 'mini'
    else delete document.documentElement.dataset.bgMedia
    useBgState.getState().set({ media: hasMedia ? (rich ? 'full' : 'mini') : 'none', kind: hasMedia ? (spec?.kind ?? null) : null })
    return () => {
      delete document.documentElement.dataset.bgMedia
      useBgState.getState().set({ media: 'none', kind: null })
    }
  }, [hasMedia, rich, spec?.kind])

  // when a video was expected but none is playing, say why (the mini player shows it)
  const settingStyle = useSettings((s) => s.settings.backgroundStyle)
  useEffect(() => {
    let text: string | null = null
    if (animated && !reduced && res && !hasMedia && (settingStyle === 'auto' || settingStyle === 'youtube')) {
      if (ytDead) text = ytWhy === 'timeout' ? 'The video didn’t start in time. It may be slow to load or blocked here.' : /error (101|150|152|153)/.test(ytWhy) ? 'This video can’t be played in Lyra (the uploader blocks it).' : `This video can’t be played in Lyra (YouTube said: ${ytWhy || 'unknown'}).`
      else if (res.youtube === 'no-key') text = 'No video for this song yet. Add a YouTube key or pick a video.'
      else if (res.youtube === 'none') text = 'No music video found for this song.'
      else if (res.youtube === 'error') text = res.youtubeMessage ? `Video search failed: ${res.youtubeMessage}` : 'Video search failed.'
    }
    useBgState.getState().setReason(text ? { text } : null)
    return () => useBgState.getState().setReason(null)
  }, [animated, reduced, res, hasMedia, ytDead, ytWhy, settingStyle])

  // gentle parallax: the picture drifts against the cursor
  useEffect(() => {
    if (!hasMedia) return
    let raf = 0
    const move = (e: PointerEvent): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = root.current
        if (!el) return
        el.style.setProperty('--px', String((e.clientX / window.innerWidth - 0.5) * 2))
        el.style.setProperty('--py', String((e.clientY / window.innerHeight - 0.5) * 2))
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [hasMedia])

  // dim: your slider is the base; the auto part lifts it for bright scenes and eases it for dark ones
  const base = rich ? dim * 0.8 : dim * 0.3
  const factor = autoDim && isVideoFile ? Math.min(1.45, Math.max(0.6, 0.62 + stats.luma * 1.5)) : isYt ? 0.7 : 1
  const dimNow = Math.min(0.9, Math.max(0.1, base * factor)) + (playing ? 0 : 0.12)

  return (
    <div
      ref={root}
      className={`backdrop ${rich ? 'backdrop--rich' : ''} ${alive ? 'backdrop--alive' : ''} ${hasMedia ? 'backdrop--media' : ''}`}
      aria-hidden="true"
      data-paused={!playing || undefined}
    >
      <div className="backdrop__field" />
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            className="backdrop__img"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            draggable={false}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {hasMedia && spec && (
          <motion.div key={specKey} className="backdrop__stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }}>
            {showMedia && mediaUrl && (isImage ? <ImageLayer url={mediaUrl} onFail={fail} /> : <LoopVideo url={mediaUrl} run={run} crop={stats.crop} videoRef={videoRef} onFail={fail} />)}
            {showYt && spec.kind === 'youtube' && <YoutubeLayer spec={spec} run={run} onFail={fail} />}
          </motion.div>
        )}
      </AnimatePresence>
      {rich && (
        <>
          <i className="backdrop__blob backdrop__blob--a" />
          <i className="backdrop__blob backdrop__blob--b" />
        </>
      )}
      <div className="backdrop__shade" />
      {hasMedia && <div className="backdrop__dim" style={{ opacity: dimNow }} />}
      {hasMedia && <div className="backdrop__grade" />}
    </div>
  )
}
