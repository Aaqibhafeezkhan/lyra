import '@fontsource-variable/inter'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { estimateWords } from '@shared/wordTiming'
import logoUrl from '@/assets/logo.png'
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
import './record.css'

/**
 * The page the phone records for a lyric video (RecordActivity captures this screen and Spotify's sound).
 * Clean on purpose: the song's video (or the blurred cover) behind big lyrics, the song, a small "Made with Lyra"
 * badge, and a closing card. After a short countdown the song restarts from the top; when it ends (or the user
 * stops) the closing card plays and the native side saves the file.
 */
declare global {
  interface Window {
    __lyraRecord?: { finish(): void }
  }
}

const fromStart = new URLSearchParams(location.search).has('fromStart')
const END_CARD_MS = 2800
/** a song's identity here: its id changes while it plays, so use what it is called */
const songKey = (t: { title: string; artists: string[] }): string => `${t.title}|${t.artists[0] ?? ''}`

function CurrentLine({ line, offset }: { line: ReturnType<typeof estimateWords>[number]; offset: number }) {
  const spans = useRef<Array<HTMLSpanElement | null>>([])
  const words = line.words
  const end = line.endMs ?? line.timeMs + 4000
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
    const id = setInterval(tick, 33) // smooth: this is what gets filmed
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

function Column({ lines, idx, offset }: { lines: ReturnType<typeof estimateWords>; idx: number; offset: number }) {
  const area = useRef<HTMLDivElement>(null)
  const els = useRef<Array<HTMLParagraphElement | null>>([])
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = els.current[idx]
    const box = area.current
    if (el && box) setShift(el.offsetTop - box.clientHeight * 0.3)
  }, [idx, lines])
  return (
    <div className="amb__area" ref={area}>
      <div className="amb__scroll" style={{ transform: `translateY(${-shift}px)` }}>
        {lines.map((l, i) => (
          <p key={i} ref={(el) => void (els.current[i] = el)} className={`amb__line amb__d${Math.min(Math.abs(i - idx), 3)}`}>
            {i === idx ? <CurrentLine line={l} offset={offset} /> : l.text || '♪'}
          </p>
        ))}
      </div>
    </div>
  )
}

function Progress({ active }: { active: boolean }) {
  const dur = usePlayer((s) => s.snapshot?.track?.durationMs ?? 0)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      if (bar.current && dur > 0) bar.current.style.transform = `scaleX(${Math.min(1, getPosition() / dur)})`
    }, 200)
    return () => clearInterval(id)
  }, [dur, active])
  return (
    <div className="rec__progress">
      <div ref={bar} className="rec__progress-bar" />
    </div>
  )
}

type Phase = { name: 'count'; n: number } | { name: 'rec' } | { name: 'end' } | { name: 'problem'; message: string }

function Record() {
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const command = usePlayer((s) => s.command)
  const st = useLyrics((s) => s.state)
  const raw = st.phase === 'ready' && st.result.status === 'synced' ? st.result.lines : []
  const lines = useMemo(() => estimateWords(raw, track?.durationMs), [raw, track?.durationMs])
  const offset = useLyricOffset()
  const idx = useActiveLine(lines, lines.length > 0)
  const art = useArtwork(track?.artworkUrl ?? null)
  const pal = usePalette(art)
  const [phase, setPhase] = useState<Phase>({ name: 'count', n: 3 })
  const trackId = useRef<string | null>(null)
  const finished = useRef(false)
  const recStart = useRef(0)

  useEffect(() => {
    const p = pal ?? NEUTRAL_PALETTE
    const r = document.documentElement.style
    r.setProperty('--accent', p.accent)
    r.setProperty('--tint1', p.tint1)
    r.setProperty('--tint2', p.tint2)
  }, [pal])

  // wrap up: closing card, then stop and save (the native side leaves the screen when it is saved)
  const finish = (why = 'requested'): void => {
    if (finished.current) return
    console.log('lyra-record finish: ' + why)
    finished.current = true
    setPhase({ name: 'end' })
    window.setTimeout(() => {
      void rpc<{ ok: boolean; error?: string }>('recordFinish').then((r) => {
        if (!r.ok) setPhase({ name: 'problem', message: r.error ?? 'The video could not be saved.' })
      })
    }, END_CARD_MS)
  }
  useEffect(() => {
    window.__lyraRecord = { finish: () => finish('stop button') }
    return () => void delete window.__lyraRecord
  })

  // nothing playing: say so and leave
  useEffect(() => {
    if (phase.name !== 'count' || track) return
    const id = window.setTimeout(() => {
      if (!usePlayer.getState().snapshot?.track) void rpc('recordAbort')
    }, 3500)
    return () => window.clearTimeout(id)
  }, [phase.name, track])

  // countdown, then go: the recording starts, the song restarts from the top
  useEffect(() => {
    if (phase.name !== 'count' || !track) return
    // Android only routes a player into the capture if it starts after the capture exists, so the song is paused
    // for the last second of the countdown and started again once recording runs
    if (fromStart && phase.n === 1 && usePlayer.getState().snapshot?.isPlaying) void command({ type: 'pause' })
    if (phase.n > 0) {
      const id = window.setTimeout(() => setPhase({ name: 'count', n: phase.n - 1 }), 1000)
      return () => window.clearTimeout(id)
    }
    let live = true
    void (async () => {
      const r = await rpc<{ ok: boolean; error?: string }>('recordGo', `${track.title} ${track.artists[0] ?? ''}`)
      if (!live) return
      if (!r.ok) {
        setPhase({ name: 'problem', message: r.error ?? 'Recording could not start.' })
        window.setTimeout(() => void rpc('recordAbort'), 3500)
        return
      }
      recStart.current = Date.now()
      trackId.current = songKey(track)
      setPhase({ name: 'rec' })
      if (fromStart) void command({ type: 'seek', positionMs: 0 })
      if (!usePlayer.getState().snapshot?.isPlaying) void command({ type: 'play' })
    })()
    return () => {
      live = false
    }
  }, [phase, track?.id])

  // while recording: stop when the song ends, changes, or has been paused for a while
  useEffect(() => {
    if (phase.name !== 'rec') return
    let pausedSince = 0
    let changedSince = 0
    const id = window.setInterval(() => {
      const s = usePlayer.getState().snapshot
      const d = s?.track?.durationMs ?? 0
      const since = Date.now() - recStart.current
      // a different song for more than a moment (the player can briefly report something else while it seeks)
      if (s?.track && songKey(s.track) !== trackId.current) {
        changedSince = changedSince || Date.now()
        if (Date.now() - changedSince > 2000) return finish('song changed')
      } else changedSince = 0
      if (since > 3000 && d > 0 && getPosition() >= d - 400) return finish('song end ' + getPosition() + '/' + d)
      if (since > 3000 && !s?.isPlaying) {
        pausedSince = pausedSince || Date.now()
        if (Date.now() - pausedSince > 5000) finish('paused')
      } else pausedSince = 0
    }, 250)
    return () => window.clearInterval(id)
  }, [phase.name])

  const recording = phase.name === 'rec'
  return (
    <div className="amb amb--video amb--rec">
      <div className="amb__bg" aria-hidden="true">
        <Backdrop animated />
      </div>
      <div className="rec__content">
        <div className="rec__lyrics">
          {lines.length > 0 && idx >= 0 ? <Column lines={lines} idx={idx} offset={offset} /> : <p className="amb__line rec__idle">{track ? '♪' : 'Play a song in Spotify first'}</p>}
        </div>
        <div className="amb__foot">
          {art && <img className="rec__art" src={art} alt="" />}
          <div className="amb__meta">
            <div className="rec__title">{track ? track.title : 'Nothing playing'}</div>
            <div className="rec__artist">{track ? track.artists.join(', ') : ''}</div>
          </div>
        </div>
        <Progress active={recording} />
        <div className="rec__badge">Made with Lyra ♥</div>
      </div>

      {phase.name === 'count' && track && (
        <div className="rec__count">
          <span key={phase.n}>{phase.n > 0 ? phase.n : '♪'}</span>
          <small>{fromStart ? 'Restarting the song from the top…' : 'Recording starts…'}</small>
        </div>
      )}
      {phase.name === 'problem' && <div className="rec__count rec__count--msg">{phase.message}</div>}
      {phase.name === 'end' && (
        <div className="rec__end">
          <img src={logoUrl} alt="" />
          <b>Make lyric videos like this</b>
          <span>Download Lyra, free</span>
          <em>lyra-website-rho.vercel.app</em>
        </div>
      )}
    </div>
  )
}

void (async () => {
  await useSettings.getState().init()
  await usePlayer.getState().init()
  useLyrics.getState().init()
  document.documentElement.dataset.theme = 'dark'
  createRoot(document.getElementById('root')!).render(<Record />)
})()
