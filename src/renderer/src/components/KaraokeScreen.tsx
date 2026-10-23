import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { LyricLine, YoutubeVideo } from '@shared/types'
import { estimateWords } from '@shared/wordTiming'
import { parseVideoId, useKaraokePlayer } from '@/lib/karaoke/player'
import { openMic, type Mic } from '@/lib/karaoke/mic'
import { scoreLine, summarize, type Frame, type KLine, type LineResult, type Summary } from '@/lib/karaoke/score'
import { useLyrics } from '@/store/lyrics'
import { usePlayer } from '@/store/player'
import { Icon } from './Icon'
import '@/styles/karaoke.css'

/**
 * Karaoke: a karaoke / instrumental version of the song plays (YouTube), Lyra shows the lyrics word by word, and the
 * microphone is scored: how much of each line you sang, and how cleanly (see lib/karaoke/score.ts).
 */
type Phase = 'pick' | 'calm' | 'count' | 'sing' | 'done'

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const offsetKey = 'lyra.karaoke.offsets'
const bestKey = 'lyra.karaoke.best'
const read = <T,>(k: string): Record<string, T> => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, T>
  } catch {
    return {}
  }
}

export function KaraokeScreen({ onClose }: { onClose: () => void }): ReactElement {
  // the song is fixed when the screen opens (Spotify may move on), and Spotify is paused so only the karaoke music plays
  const [track] = useState(() => usePlayer.getState().snapshot?.track ?? null)
  const lyrics = useLyrics((s) => s.state)
  const lines: LyricLine[] = useMemo(
    () => (lyrics.phase === 'ready' && lyrics.result.status === 'synced' ? estimateWords(lyrics.result.lines, track?.durationMs) : []),
    [lyrics, track?.durationMs]
  )
  // where each line is sung: from its start to the next line's start (at most 9 s, and a little before the next one)
  const kl: KLine[] = useMemo(
    () => lines.map((l, i) => ({ startMs: l.timeMs, endMs: Math.min(l.endMs ?? Infinity, (lines[i + 1]?.timeMs ?? l.timeMs + 6000) - 150, l.timeMs + 9000), text: l.text })),
    [lines]
  )

  const [phase, setPhase] = useState<Phase>('pick')
  const [videos, setVideos] = useState<YoutubeVideo[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [videoId, setVideoId] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [offsetMs, setOffsetMs] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [pos, setPos] = useState(-4000)
  const [count, setCount] = useState(3)
  const [hud, setHud] = useState<{ points: number; last: LineResult | null; streak: number }>({ points: 0, last: null, streak: 0 })
  const [summary, setSummary] = useState<Summary | null>(null)
  const [level, setLevel] = useState(0)
  const [leak, setLeak] = useState(false)

  const player = useKaraokePlayer(videoId)
  const mic = useRef<Mic | null>(null)
  const frames = useRef<Frame[]>([])
  const done = useRef<LineResult[]>([])
  const offsetRef = useRef(0)
  offsetRef.current = offsetMs
  const trackId = track?.id ?? ''

  // microphone permission is only allowed while this screen is open
  useEffect(() => {
    void window.lyra.studio.setMic(true)
    if (usePlayer.getState().snapshot?.isPlaying) void usePlayer.getState().command({ type: 'pause' })
    return () => {
      void window.lyra.studio.setMic(false)
      mic.current?.stop()
    }
  }, [])

  // the stored timing nudge and a search for karaoke versions of this song
  useEffect(() => {
    if (!track) return
    setOffsetMs(read<number>(offsetKey)[track.id] ?? 0)
    setVideos(null)
    setSearchError(null)
    void window.lyra.background.karaokeVideos(track).then((r) => {
      setVideos(r.items)
      setSearchError(r.error ?? null)
      if (r.items[0]) setVideoId((cur) => cur ?? r.items[0]!.videoId)
    })
    // the id is what matters, not the object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId])

  const nudge = (ms: number): void => {
    const next = Math.max(-15000, Math.min(15000, offsetMs + ms))
    setOffsetMs(next)
    const all = read<number>(offsetKey)
    all[trackId] = next
    localStorage.setItem(offsetKey, JSON.stringify(all))
  }

  const finish = useCallback((): void => {
    player.pause()
    mic.current?.stop()
    mic.current = null
    // lines that were not finished count with what was heard so far
    const list = [...done.current]
    for (let i = list.length; i < kl.length; i++) list.push(scoreLine(i, kl[i]!, frames.current))
    const s = summarize(list)
    setSummary(s)
    setPhase('done')
    const best = read<number>(bestKey)
    if (s.total > (best[trackId] ?? 0)) {
      best[trackId] = s.total
      localStorage.setItem(bestKey, JSON.stringify(best))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kl, trackId, player.pause])

  const start = async (): Promise<void> => {
    setMessage(null)
    if (!kl.length) return setMessage('This song has no synced lyrics, so karaoke cannot follow it.')
    if (!videoId || !player.ready) return setMessage('The karaoke video is still loading.')
    frames.current = []
    done.current = []
    setHud({ points: 0, last: null, streak: 0 })
    setSummary(null)
    try {
      mic.current?.stop()
      mic.current = await openMic()
    } catch {
      return setMessage('Lyra could not use the microphone. Allow it in Windows (Settings, Privacy, Microphone) and try again.')
    }
    setPhase('calm')
    await mic.current.calibrate(1400)
    setPhase('count')
    for (let n = 3; n >= 1; n--) {
      setCount(n)
      await new Promise((r) => setTimeout(r, 900))
    }
    player.seek(0)
    player.play()
    setPhase('sing')
  }

  // while singing: the clock, the microphone and the scoring
  useEffect(() => {
    if (phase !== 'sing' || !mic.current) return
    const m = mic.current
    let raf = 0
    let finishedLines = 0
    let loudRun = 0
    const stopWatch = m.watch((r) => {
      setLevel(m.level())
      if (!player.isPlaying()) return
      const t = player.now() * 1000 + offsetRef.current
      frames.current.push({ tMs: t, voiced: r.voiced, cents: r.cents })
      // the microphone hearing the music all the time, before the first line: speakers, not headphones
      if (t < (kl[0]?.startMs ?? 0) - 500 && t > 0) loudRun = r.voiced ? loudRun + 1 : 0
      if (loudRun > 60) setLeak(true)
    })
    const tick = (): void => {
      const t = player.now() * 1000 + offsetRef.current
      setPos(t)
      // score the lines that are over
      while (finishedLines < kl.length && t > kl[finishedLines]!.endMs + 200) {
        const r = scoreLine(finishedLines, kl[finishedLines]!, frames.current)
        done.current.push(r)
        finishedLines++
        const s = summarize(done.current)
        setHud({ points: s.total, last: r, streak: s.bestStreak })
      }
      const lastEnd = kl[kl.length - 1]?.endMs ?? 0
      if (finishedLines >= kl.length && t > lastEnd + 1500) return finish()
      if (player.length() > 0 && player.now() > player.length() - 0.5) return finish()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      stopWatch()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // which line is on
  const active = useMemo(() => {
    let a = -1
    for (let i = 0; i < lines.length; i++) if (pos >= lines[i]!.timeMs) a = i
    return a
  }, [pos, lines])
  const untilFirst = lines.length ? lines[0]!.timeMs - pos : 0
  const gapToNext = active >= 0 && lines[active + 1] ? lines[active + 1]!.timeMs - (kl[active]?.endMs ?? 0) : 0
  const inBreak = active >= 0 && lines[active + 1] && pos > (kl[active]?.endMs ?? 0) + 600 && gapToNext > 0

  const pickVideo = (id: string): void => {
    setVideoId(id)
    setMessage(null)
  }

  return (
    <div className="karaoke" role="dialog" aria-label="Karaoke" data-nodrag>
      <header className="karaoke__head">
        <b>Karaoke</b>
        <span>{track ? `${track.title} · ${track.artists[0] ?? ''}` : ''}</span>
        <button type="button" className="ibtn" aria-label="Close karaoke" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>

      {/* the karaoke video is only a source of music; its picture stays out of the way */}
      <iframe ref={player.frame} className="karaoke__frame" src={player.src || 'about:blank'} title="Karaoke music" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" onLoad={player.onLoad} />

      {phase === 'pick' && (
        <div className="karaoke__body">
          {!track && <p className="karaoke__hint">Play a song in Spotify first.</p>}
          {track && lines.length === 0 && <p className="karaoke__hint">Waiting for this song's synced lyrics… Karaoke needs them to follow along.</p>}
          {track && (
            <>
              <h4>Backing music</h4>
              {videos === null && !searchError && <p className="karaoke__hint">Looking for a karaoke version…</p>}
              {searchError && <p className="karaoke__hint karaoke__hint--warn">{searchError}</p>}
              {videos && videos.length === 0 && !searchError && <p className="karaoke__hint">No karaoke version found. Paste a YouTube link below.</p>}
              <div className="karaoke__list">
                {(videos ?? []).slice(0, 5).map((v) => (
                  <button key={v.videoId} type="button" className={`pill ${videoId === v.videoId ? 'pill--primary' : ''}`} onClick={() => pickVideo(v.videoId)}>
                    {v.title} · {v.channel}
                    {v.durationSec ? ` · ${fmt(v.durationSec)}` : ''}
                  </button>
                ))}
              </div>
              <div className="karaoke__paste">
                <input value={paste} placeholder="Or paste a YouTube link" onChange={(e) => setPaste(e.target.value)} aria-label="YouTube link" />
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    const id = parseVideoId(paste)
                    if (id) pickVideo(id)
                    else setMessage('That does not look like a YouTube link.')
                  }}
                >
                  Use
                </button>
              </div>
              <p className="karaoke__hint">Wear headphones: the microphone must hear you, not the music. Stay quiet for a moment when it starts, it listens to the room first.</p>
              <div className="karaoke__nudge">
                <span>Lyrics timing</span>
                <button type="button" className="pill" onClick={() => nudge(-500)}>−0.5 s</button>
                <b>{(offsetMs / 1000).toFixed(1)} s</b>
                <button type="button" className="pill" onClick={() => nudge(500)}>+0.5 s</button>
              </div>
              {message && <p className="karaoke__hint karaoke__hint--warn">{message}</p>}
              <button type="button" className="pill pill--primary karaoke__go" disabled={!videoId || !lines.length} onClick={() => void start()}>
                {player.ready ? 'Start singing' : 'Loading the music…'}
              </button>
              {read<number>(bestKey)[trackId] ? <p className="karaoke__hint">Your best: {read<number>(bestKey)[trackId]} points</p> : null}
            </>
          )}
        </div>
      )}

      {phase === 'calm' && <div className="karaoke__center"><h2>Shh…</h2><p>Listening to the room, stay quiet for a second.</p></div>}
      {phase === 'count' && <div className="karaoke__center"><h1 key={count}>{count}</h1><p>Get ready</p></div>}

      {phase === 'sing' && (
        <div className="karaoke__stage">
          <div className="karaoke__hud">
            <span>{hud.points} pts</span>
            {hud.last && <b className={`grade grade--${hud.last.grade}`} key={hud.last.index}>{hud.last.grade === 'perfect' ? 'Perfect!' : hud.last.grade === 'great' ? 'Great' : hud.last.grade === 'ok' ? 'OK' : 'Miss'}</b>}
            <span className="karaoke__meter"><i style={{ transform: `scaleX(${level})` }} /></span>
          </div>
          {leak && <p className="karaoke__hint karaoke__hint--warn">The microphone is hearing the music. Headphones will make the score fair.</p>}
          <div className="karaoke__lines">
            {active < 0 && untilFirst > 0 && (
              <div className="dots" aria-label="Get ready">
                {[0, 1, 2, 3].map((i) => (
                  <i key={i} className={untilFirst < (4 - i) * 1000 ? 'is-on' : ''} />
                ))}
              </div>
            )}
            {[active - 1, active, active + 1, active + 2].map((i) => {
              const l = lines[i]
              if (!l) return <div key={i} className="kline kline--empty" />
              const isNow = i === active
              return (
                <div key={i} className={`kline ${isNow ? 'kline--now' : i < active ? 'kline--past' : 'kline--next'}`}>
                  {isNow && l.words && l.words.length > 1
                    ? l.words.map((w, k) => {
                        const next = l.words![k + 1]?.timeMs ?? l.endMs ?? l.timeMs + 4000
                        const p = Math.max(0, Math.min(1, (pos - w.timeMs) / Math.max(1, next - w.timeMs)))
                        return <span key={k} className="kword" style={{ ['--p' as string]: p.toFixed(2) }}>{w.text} </span>
                      })
                    : l.text || '♪'}
                </div>
              )
            })}
            {inBreak && <div className="dots dots--break" aria-label="Instrumental"><i className="is-on" /><i className="is-on" /><i className="is-on" /></div>}
          </div>
          <div className="karaoke__controls">
            <button type="button" className="ibtn" aria-label="Pause" onClick={() => (player.playing ? player.pause() : player.play())}>
              <Icon name={player.playing ? 'pause' : 'play'} size={18} />
            </button>
            <button type="button" className="pill" onClick={() => nudge(-200)}>Lyrics earlier</button>
            <button type="button" className="pill" onClick={() => nudge(200)}>Lyrics later</button>
            <button type="button" className="pill" onClick={finish}>Finish</button>
          </div>
        </div>
      )}

      {phase === 'done' && summary && (
        <div className="karaoke__body karaoke__results">
          <div className="stars" aria-label={`${summary.stars} of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={n <= summary.stars ? 'is-on' : ''}>★</span>
            ))}
          </div>
          <h2>{summary.total} points</h2>
          <p className="karaoke__hint">
            You sang {Math.round(summary.sungShare * 100)}% of the lines · best streak {summary.bestStreak}
            {read<number>(bestKey)[trackId] === summary.total ? ' · new best!' : ''}
          </p>
          <div className="karaoke__review">
            {summary.lines.map((r) => (
              <div key={r.index} className={`review review--${r.grade}`}>
                <span>{r.text || '♪'}</span>
                <b>{r.points}</b>
              </div>
            ))}
          </div>
          <div className="karaoke__controls">
            <button type="button" className="pill pill--primary" onClick={() => { setPhase('pick'); setPos(-4000); player.seek(0); player.pause() }}>Sing again</button>
            <button type="button" className="pill" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
