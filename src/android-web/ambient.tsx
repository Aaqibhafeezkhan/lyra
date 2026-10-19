import '@fontsource-variable/inter'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { estimateWords } from '@shared/wordTiming'
import { Backdrop } from '@/components/Backdrop'
import { useArtwork, usePalette } from '@/hooks/useArtwork'
import { lyricPosition, useActiveLine } from '@/hooks/useLyricsSync'
import { NEUTRAL_PALETTE } from '@/lib/palette'
import { useLyrics } from '@/store/lyrics'
import { useLyricOffset } from '@/store/offsets'
import { getPosition, usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import '@/styles/tokens.css'
import '@/styles/base.css'
import { rpc } from './rpc'
import './ambient.css'

/**
 * Ambient lyrics: an always-on-display style screen for the desk / bedside / charger.
 *  - Minimal: pure black
 *  - Glow:    the cover's colours as a dim, slowly moving glow
 *  - Video:   the music video (or your own) played dim
 * It drifts a little every minute so no OLED pixel stays lit. Touching the screen only shows the controls
 * (the on/off switch, brightness, play/pause); it never switches ambient mode off by accident.
 */
function useClock(): { time: string; date: string } {
  const read = (): { time: string; date: string } => {
    const d = new Date()
    // digits only (the am/pm marker wrapped onto a second line at this size)
    const time = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
      .formatToParts(d)
      .filter((p) => p.type !== 'dayPeriod' && !(p.type === 'literal' && /\s/.test(p.value)))
      .map((p) => p.value)
      .join('')
    return { time, date: d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) }
  }
  const [t, setT] = useState(read)
  useEffect(() => {
    const id = setInterval(() => setT(read()), 15_000)
    return () => clearInterval(id)
  }, [])
  return t
}

/** The cover's colours drive the glow (same palette the main player uses). */
function useCoverColours(): void {
  const url = usePlayer((s) => s.snapshot?.track?.artworkUrl ?? null)
  const art = useArtwork(url)
  const pal = usePalette(art)
  useEffect(() => {
    const p = pal ?? NEUTRAL_PALETTE
    const r = document.documentElement.style
    r.setProperty('--accent', p.accent)
    r.setProperty('--tint1', p.tint1)
    r.setProperty('--tint2', p.tint2)
  }, [pal])
}

/** Words fill in as they are sung (about 15 updates a second: smooth enough and easy on the battery). */
function CurrentLine({ line, nextTime, offset }: { line: ReturnType<typeof estimateWords>[number]; nextTime: number | undefined; offset: number }) {
  const spans = useRef<Array<HTMLSpanElement | null>>([])
  const words = line.words
  const end = line.endMs ?? nextTime ?? line.timeMs + 4000

  useEffect(() => {
    if (!words) return
    const tick = (): void => {
      const pos = lyricPosition(offset)
      words.forEach((w, i) => {
        const el = spans.current[i]
        if (!el) return
        const stop = Math.min(words[i + 1]?.timeMs ?? end, end)
        el.style.setProperty('--p', Math.min(1, Math.max(0, (pos - w.timeMs) / Math.max(1, stop - w.timeMs))).toFixed(2))
      })
    }
    tick()
    const id = setInterval(tick, 66)
    return () => clearInterval(id)
  }, [words, end, offset])

  if (!words) return <>{line.text}</>
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="amb__word" ref={(el) => void (spans.current[i] = el)}>
          {w.text}
        </span>
      ))}
    </>
  )
}

function Progress() {
  const dur = usePlayer((s) => s.snapshot?.track?.durationMs ?? 0)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tick = (): void => {
      if (bar.current && dur > 0) bar.current.style.transform = `scaleX(${Math.min(1, getPosition() / dur)})`
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [dur])
  return (
    <div className="amb__progress">
      <div ref={bar} className="amb__progress-bar" />
    </div>
  )
}

/** Lines stay on screen and glide up as the song moves on: the old line fades and shrinks, the next one grows. */
const SPRING = { type: 'spring', stiffness: 120, damping: 24, mass: 0.9 } as const
const ROLE = [
  { opacity: 0.16, scale: 0.78 }, // previous
  { opacity: 1, scale: 1 }, // current
  { opacity: 0.34, scale: 0.78 }, // next
  { opacity: 0.16, scale: 0.7 } // after that
]

function LyricStack({ lines, idx, offset }: { lines: ReturnType<typeof estimateWords>; idx: number; offset: number }) {
  const from = Math.max(0, idx - 1)
  const visible = lines.slice(from, idx + 3).map((l, k) => ({ l, i: from + k }))
  return (
    <div className="amb__stack">
      <AnimatePresence initial={false}>
        {visible.map(({ l, i }) => {
          const role = ROLE[Math.min(3, Math.max(0, i - (idx - 1)))]!
          return (
            <motion.p
              key={i}
              layout="position"
              className={`amb__line ${i === idx ? 'is-current' : ''}`}
              initial={{ opacity: 0, scale: 0.7, y: 40 }}
              animate={{ opacity: role.opacity, scale: role.scale, y: 0 }}
              exit={{ opacity: 0, scale: 0.6, y: -40 }}
              transition={SPRING}
              style={{ transformOrigin: 'left center' }}
            >
              {i === idx ? <CurrentLine line={l} nextTime={lines[i + 1]?.timeMs} offset={offset} /> : l.text || '♪'}
            </motion.p>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/** Shown for a few seconds after a touch: the on/off switch, play controls and brightness. */
function Controls({ shown, onTouch }: { shown: boolean; onTouch: () => void }) {
  const playing = usePlayer((s) => !!s.snapshot?.isPlaying)
  const brightness = useSettings((s) => s.settings.ambientBrightness)
  const set = useSettings((s) => s.set)
  const command = usePlayer((s) => s.command)
  return (
    <div className={`amb__controls ${shown ? 'is-shown' : ''}`} onPointerDown={onTouch}>
      <button
        type="button"
        role="switch"
        aria-checked="true"
        className="amb__switch"
        onClick={() => void window.lyra.android?.toggleAmbient()}
      >
        <span>Ambient mode</span>
        <i />
      </button>
      <div className="amb__transport">
        <button type="button" aria-label="Previous" onClick={() => void command({ type: 'previous' })}>
          ⏮
        </button>
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} className="amb__play" onClick={() => void command({ type: 'toggle' })}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" aria-label="Next" onClick={() => void command({ type: 'next' })}>
          ⏭
        </button>
      </div>
      <label className="amb__bright">
        <span>Brightness</span>
        <input
          type="range"
          min={0.02}
          max={0.6}
          step={0.01}
          value={brightness}
          onChange={(e) => set({ ambientBrightness: Number(e.target.value) })}
        />
      </label>
    </div>
  )
}

function Ambient() {
  const style = useSettings((s) => s.settings.ambientStyle)
  const brightness = useSettings((s) => s.settings.ambientBrightness)
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const playing = usePlayer((s) => !!s.snapshot?.isPlaying)
  const st = useLyrics((s) => s.state)
  const raw = st.phase === 'ready' && st.result.status === 'synced' ? st.result.lines : []
  const lines = useMemo(() => estimateWords(raw, track?.durationMs), [raw, track?.durationMs])
  const offset = useLyricOffset()
  const idx = useActiveLine(lines, lines.length > 0)
  const art = useArtwork(track?.artworkUrl ?? null)
  const { time, date } = useClock()
  const [drift, setDrift] = useState({ x: 0, y: 0 })
  const [shown, setShown] = useState(false)
  const hide = useRef<number>(0)
  useCoverColours()

  // the picture needs more screen brightness than plain text; the slider sets the base
  useEffect(() => {
    const level = style === 'video' ? Math.max(brightness, 0.3) : brightness
    void rpc('ambientBrightness', level).catch(() => undefined)
  }, [style, brightness])

  useEffect(() => {
    const id = setInterval(() => setDrift({ x: Math.round((Math.random() - 0.5) * 48), y: Math.round((Math.random() - 0.5) * 70) }), 45_000)
    return () => clearInterval(id)
  }, [])

  const touch = (): void => {
    setShown(true)
    window.clearTimeout(hide.current)
    hide.current = window.setTimeout(() => setShown(false), 5000)
  }

  return (
    <div className={`amb amb--${style}`} onPointerDown={touch}>
      {style !== 'minimal' && (
        <div className="amb__bg" aria-hidden="true">
          <Backdrop animated={style === 'video'} />
        </div>
      )}
      <div className="amb__content" style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}>
        <div className="amb__top">
          <div className="amb__clock">{time}</div>
          <div className="amb__date">{date}</div>
        </div>

        <div className="amb__lyrics">
          {lines.length > 0 && idx >= 0 ? <LyricStack lines={lines} idx={idx} offset={offset} /> : <p className="amb__line amb__idle">{track ? (lines.length ? '♪' : '') : ''}</p>}
        </div>

        <div className="amb__foot">
          {art && <img className="amb__art" src={art} alt="" />}
          <div className="amb__meta">
            <div className="amb__title">{track ? track.title : 'Nothing playing'}</div>
            <div className="amb__artist">{track ? `${track.artists.join(', ')}${playing ? '' : ' · paused'}` : ''}</div>
          </div>
        </div>
        <Progress />
      </div>
      <Controls shown={shown} onTouch={touch} />
    </div>
  )
}

void (async () => {
  await useSettings.getState().init()
  await usePlayer.getState().init()
  useLyrics.getState().init()
  document.documentElement.dataset.theme = 'dark'
  createRoot(document.getElementById('root')!).render(<Ambient />)
})()
