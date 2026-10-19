import '@fontsource-variable/inter'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { estimateWords } from '@shared/wordTiming'
import { Backdrop } from '@/components/Backdrop'
import { useArtwork, usePalette } from '@/hooks/useArtwork'
import { useActiveLine, lyricPosition } from '@/hooks/useLyricsSync'
import { NEUTRAL_PALETTE } from '@/lib/palette'
import { useLyrics } from '@/store/lyrics'
import { useLyricOffset } from '@/store/offsets'
import { getPosition, usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import '@/styles/tokens.css'
import '@/styles/base.css'
import './ambient.css'

/**
 * Ambient lyrics: an always-on-display style screen for the desk / bedside / charger.
 *  - Minimal: pure black
 *  - Glow:    the cover's colours as a very dim, slowly moving glow
 *  - Video:   the music video (or your own) played very dim
 * Everything is kept dark (OLED friendly), drifts a little every minute so no pixel stays lit, and updates at a
 * low rate to save battery. Used by the "Ambient screen" and by the Android screen saver.
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

/** The cover's colours drive the dim glow (same palette the main player uses). */
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

/** Current line with its words filling in as they are sung (about 15 updates a second: smooth enough, easy on the battery). */
function Line({ lines, idx, offset }: { lines: ReturnType<typeof estimateWords>; idx: number; offset: number }) {
  const line = lines[idx]
  const spans = useRef<Array<HTMLSpanElement | null>>([])
  const words = line?.words
  const end = line?.endMs ?? lines[idx + 1]?.timeMs ?? (line ? line.timeMs + 4000 : 0)

  useEffect(() => {
    if (!words) return
    const tick = (): void => {
      const pos = lyricPosition(offset)
      words.forEach((w, i) => {
        const el = spans.current[i]
        if (!el) return
        const stop = Math.min(words[i + 1]?.timeMs ?? end, end)
        el.style.setProperty('--p', String(Math.min(1, Math.max(0, (pos - w.timeMs) / Math.max(1, stop - w.timeMs))).toFixed(2)))
      })
    }
    tick()
    const id = setInterval(tick, 66)
    return () => clearInterval(id)
  }, [words, end, offset])

  if (!line) return null
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

function Ambient() {
  const style = useSettings((s) => s.settings.ambientStyle)
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const playing = usePlayer((s) => !!s.snapshot?.isPlaying)
  const st = useLyrics((s) => s.state)
  const raw = st.phase === 'ready' && st.result.status === 'synced' ? st.result.lines : []
  const lines = useMemo(() => estimateWords(raw, track?.durationMs), [raw, track?.durationMs])
  const offset = useLyricOffset()
  const idx = useActiveLine(lines, lines.length > 0)
  const next = lines[idx + 1]?.text ?? ''
  const art = useArtwork(track?.artworkUrl ?? null)
  const { time, date } = useClock()
  const [drift, setDrift] = useState({ x: 0, y: 0 })
  useCoverColours()

  useEffect(() => {
    const id = setInterval(() => setDrift({ x: Math.round((Math.random() - 0.5) * 48), y: Math.round((Math.random() - 0.5) * 70) }), 45_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={`amb amb--${style}`}>
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={`${track?.id}:${idx}`} className="amb__cur" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
              {track ? (lines[idx] ? <Line lines={lines} idx={idx} offset={offset} /> : lines.length ? '♪' : '') : ''}
            </motion.p>
          </AnimatePresence>
          <p className="amb__next">{next}</p>
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
