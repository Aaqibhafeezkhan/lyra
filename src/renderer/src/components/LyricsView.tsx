import { memo, useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LyricLine, LyricsResult } from '@shared/types'
import { romanizeLyrics as romanize } from '@core/lyrics/romanize'
import { useActiveLine, useFrame, lyricPosition } from '@/hooks/useLyricsSync'
import { useReducedMotion } from '@/hooks/useMotion'
import { clamp } from '@/lib/format'
import { estimateWords } from '@shared/wordTiming'
import { useLyrics } from '@/store/lyrics'
import { usePlayer } from '@/store/player'
import { OFFSET_STEP_MS, nudgeSongOffset, useLyricOffset, useSongOffset } from '@/store/offsets'
import { useSettings } from '@/store/settings'
import { useUi } from '@/store/ui'
import { useControlsLocked } from './Controls'
import { Icon, type IconName } from './Icon'
import { ShareCard } from './ShareCard'

const RESUME_AFTER_MS = 6000

interface Props {
  variant: 'mini' | 'full'
}

export function LyricsView({ variant }: Props) {
  const state = useLyrics((s) => s.state)
  const retry = useLyrics((s) => s.retry)
  const s = useSettings((x) => x.settings)

  const style = {
    ['--lyric-size' as string]: `${variant === 'full' ? s.lyricFontSize : Math.round(clamp(s.lyricFontSize * 0.52, 18, 26))}px`,
    ['--lyric-leading' as string]: s.lineSpacing
  }

  let body: React.ReactNode
  if (state.phase === 'idle') body = null
  else if (state.phase === 'loading') body = <LyricsSkeleton />
  else {
    const r = state.result
    if (r.status === 'synced') body = <SyncedLyrics key={r.trackId} result={r} variant={variant} />
    else if (r.status === 'plain') body = <PlainLyrics key={r.trackId} result={r} />
    else if (r.status === 'instrumental')
      body = (
        <LyricsMessage
          icon="note"
          title="Instrumental"
          body="This track has no vocals. Enjoy the music."
          visual={
            <div className="eq" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${i * 140}ms` }} />
              ))}
            </div>
          }
        />
      )
    else if (r.status === 'error')
      body = (
        <LyricsMessage
          icon={r.error?.kind === 'network' ? 'wifiOff' : 'alert'}
          title={r.error?.kind === 'rate-limit' ? 'Lyrics service is busy' : 'Couldn’t load lyrics'}
          body={r.error?.kind === 'rate-limit' ? 'The free lyrics service is busy right now. Lyra will keep trying in the background.' : (r.error?.message ?? 'Something went wrong while fetching lyrics.')}
          action={r.error?.retryable === false ? undefined : { label: 'Try again', icon: 'refresh', run: retry }}
        />
      )
    else
      body = (
        <LyricsMessage
          icon="note"
          title="No lyrics for this track"
          body="We couldn’t find a match from the lyrics provider. The song may be too new, or listed under a different title."
          action={{ label: 'Search again', icon: 'refresh', run: retry }}
          secondary={{ label: 'Pick a match manually', run: () => useUi.getState().setPanel('lyrics') }}
        />
      )
  }

  return (
    <div className={`lyrics lyrics--${variant}`} data-font={s.lyricFont} data-anim={s.lyricAnimation} style={style}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={state.phase === 'ready' ? `${state.result.trackId}:${state.result.status}` : state.phase}
          className="lyrics__stage"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
      {state.phase === 'ready' && (state.result.status === 'synced' || state.result.status === 'plain') && (
        <LyricsFooter result={state.result} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

function SyncedLyrics({ result, variant }: { result: LyricsResult; variant: 'mini' | 'full' }) {
  const wordByWord = useSettings((x) => x.settings.wordByWord)
  const showRomanization = useSettings((x) => x.settings.romanizeLyrics)
  const durationMs = usePlayer((x) => x.snapshot?.track?.durationMs)
  const estimated = wordByWord && !result.wordSynced
  const lines = useMemo(() => (estimated ? estimateWords(result.lines, durationMs) : result.lines), [estimated, result.lines, durationMs])
  const active = useActiveLine(lines)
  const reduced = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const refs = useRef<Array<HTMLDivElement | null>>([])
  const follow = useRef(true)
  const resumeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [showReturn, setShowReturn] = useState(false)
  const { locked } = useControlsLocked()
  const seek = usePlayer((s) => s.seek)
  const offset = useLyricOffset()
  const toast = useUi((s) => s.toast)

  const scrollToActive = useCallback(
    (instant = false) => {
      const box = scroller.current
      const el = refs.current[Math.max(0, active)]
      if (!box || !el) return
      const top = el.offsetTop - box.clientHeight * (variant === 'full' ? 0.36 : 0.3) + el.offsetHeight / 2
      box.scrollTo({ top: Math.max(0, top), behavior: instant || reduced ? 'auto' : 'smooth' })
    },
    [active, reduced, variant]
  )

  // follow the song
  useLayoutEffect(() => {
    if (follow.current) scrollToActive(active < 0)
  }, [active, scrollToActive])

  // keep the current line in place when the lyrics area grows or shrinks (e.g. the phone player hiding its controls)
  useEffect(() => {
    const box = scroller.current
    if (!box || typeof ResizeObserver === 'undefined') return
    // Re-centre once the area has stopped changing size. Doing it on every step of a size animation forces a layout
    // calculation per frame and makes the animation stutter.
    let settle: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(settle)
      settle = setTimeout(() => {
        if (follow.current) scrollToActive()
      }, 160)
    })
    ro.observe(box)
    return () => {
      clearTimeout(settle)
      ro.disconnect()
    }
  }, [scrollToActive])

  useEffect(() => () => clearTimeout(resumeTimer.current), [])

  const resume = useCallback(() => {
    clearTimeout(resumeTimer.current)
    follow.current = true
    setShowReturn(false)
    scrollToActive()
  }, [scrollToActive])

  const userScrolled = useCallback(() => {
    follow.current = false
    setShowReturn(true)
    clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(resume, RESUME_AFTER_MS)
  }, [resume])

  const save = useCallback(
    (line: LyricLine) => {
      const t = usePlayer.getState().snapshot?.track
      if (!t || !line.text) return
      void window.lyra.moments
        .add({ trackId: t.id, title: t.title, artist: t.artists.join(', '), artworkUrl: t.artworkUrl, text: line.text, timeMs: line.timeMs })
        .then(() => toast('Saved to your moments'))
    },
    [toast]
  )

  const [shareIndex, setShareIndex] = useState<number | null>(null)

  const seekTo = useCallback(
    (line: LyricLine) => {
      if (locked) return
      seek(line.timeMs - offset)
    },
    [locked, seek, offset]
  )

  return (
    <>
      <div
        ref={scroller}
        className="lyrics__scroller"
        data-browsing={showReturn || undefined}
        data-nodrag
        onWheel={userScrolled}
        onTouchMove={userScrolled}
        onKeyDown={(e) => ['PageUp', 'PageDown', 'Home', 'End'].includes(e.key) && userScrolled()}
        tabIndex={-1}
      >
        <div className="lyrics__inner">
          {lines.map((line, i) => (
            <LyricRow
              key={i}
              line={line}
              showRomanization={showRomanization}
              ref={(el) => {
                refs.current[i] = el
              }}
              dist={i - active}
              nextTime={lines[i + 1]?.timeMs}
              canSeek={!locked}
              onSeek={seekTo}
              onSave={save}
              onShare={(l) => setShareIndex(lines.indexOf(l))}
            />
          ))}
        </div>
      </div>
      <AnimatePresence>
        {showReturn && (
          <motion.button
            type="button"
            className="pill lyrics__return"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            onClick={resume}
          >
            <Icon name="chevronDown" size={14} />
            Current line
          </motion.button>
        )}
      </AnimatePresence>
      {shareIndex !== null && <ShareCard lines={lines} index={Math.max(0, shareIndex)} onClose={() => setShareIndex(null)} />}
    </>
  )
}

interface RowProps {
  line: LyricLine
  showRomanization: boolean
  dist: number
  nextTime: number | undefined
  canSeek: boolean
  onSeek(l: LyricLine): void
  onSave(l: LyricLine): void
  onShare(l: LyricLine): void
  ref: React.Ref<HTMLDivElement>
}

const LyricRow = memo(function LyricRow({ line, showRomanization, dist, nextTime, canSeek, onSeek, onSave, onShare, ref }: RowProps) {
  const isActive = dist === 0
  const d = Math.min(Math.abs(dist), 6)
  const gap = line.text === ''
  return (
    <div
      ref={ref}
      className={`lyric ${isActive ? 'is-active' : dist < 0 ? 'is-past' : 'is-next'} ${gap ? 'is-gap' : ''}`}
      data-dist={d}
      aria-current={isActive ? 'true' : undefined}
    >
      {gap ? (
        <span className="lyric__dots" aria-label="instrumental break">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <>
          <button
            type="button"
            className="lyric__text"
            tabIndex={-1}
            data-seekable={canSeek || undefined}
            onClick={() => onSeek(line)}
          >
            {isActive && line.words && line.words.length > 1 ? <WordLine line={line} nextTime={nextTime} /> : line.text}
            {showRomanization && romanize(line.text) !== line.text && (
              <span style={{ display: 'block', fontSize: '0.72em', opacity: 0.78, fontWeight: 400, lineHeight: 1.35 }}>
                {romanize(line.text)}
              </span>
            )}
          </button>
          <button type="button" className="lyric__save" aria-label="Save this line to your moments" title="Save line" onClick={() => onSave(line)}>
            <Icon name="bookmark" size={14} />
          </button>
          <button type="button" className="lyric__save" aria-label="Share this line as a card" title="Share as a card" onClick={() => onShare(line)}>
            <Icon name="share" size={14} />
          </button>
        </>
      )}
    </div>
  )
})

/** Word-by-word highlight. Drives a CSS variable per word each frame; no React re-renders. */
function WordLine({ line, nextTime }: { line: LyricLine; nextTime: number | undefined }) {
  const words = line.words!
  const spans = useRef<Array<HTMLSpanElement | null>>([])
  const offset = useLyricOffset()
  const end = line.endMs ?? nextTime ?? words[words.length - 1]!.timeMs + 1500

  useFrame(
    () => {
      const pos = lyricPosition(offset)
      for (let i = 0; i < words.length; i++) {
        const el = spans.current[i]
        if (!el) continue
        const start = words[i]!.timeMs
        const stop = Math.min(words[i + 1]?.timeMs ?? end, end)
        const p = clamp((pos - start) / Math.max(1, stop - start), 0, 1)
        el.style.setProperty('--p', p.toFixed(3))
      }
    },
    true,
    [words, end, offset]
  )

  return (
    <>
      {words.map((w, i) => (
        <span
          key={i}
          className="word"
          ref={(el) => {
            spans.current[i] = el
          }}
        >
          {w.text}
        </span>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------------------------

function PlainLyrics({ result }: { result: LyricsResult }) {
  const showRomanization = useSettings((x) => x.settings.romanizeLyrics)
  const paragraphs = (result.plain ?? '').split(/\n{2,}/)
  return (
    <div className="lyrics__scroller lyrics__scroller--plain" data-nodrag tabIndex={-1}>
      <div className="lyrics__inner lyrics__inner--plain">
        <p className="lyrics__notice">
          <Icon name="alert" size={13} /> These lyrics aren’t time-synced, so they won’t follow the song.
        </p>
        {paragraphs.map((p, i) => (
          <p key={i} className="plain__stanza">
            {p.split('\n').map((l, j) => (
              <span key={j} style={{ display: 'block' }}>
                {l}
                {showRomanization && romanize(l) !== l && (
                  <span style={{ display: 'block', fontSize: '0.82em', opacity: 0.78 }}>{romanize(l)}</span>
                )}
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  )
}

function LyricsSkeleton() {
  const widths = [62, 80, 54, 72, 44, 68]
  return (
    <div className="lyrics__skeleton" aria-busy="true" aria-label="Loading lyrics">
      {widths.map((w, i) => (
        <i key={i} style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  )
}

interface MsgProps {
  icon: IconName
  title: string
  body: string
  action?: { label: string; icon: IconName; run(): void }
  secondary?: { label: string; run(): void }
  visual?: React.ReactNode
}

function LyricsMessage({ icon, title, body, action, secondary, visual }: MsgProps) {
  return (
    <div className="lyrics__message">
      {visual ?? <Icon name={icon} size={26} />}
      <h3>{title}</h3>
      <p>{body}</p>
      {action && (
        <button type="button" className="pill" onClick={action.run}>
          <Icon name={action.icon} size={14} />
          {action.label}
        </button>
      )}
      {secondary && (
        <button type="button" className="linkbtn" onClick={secondary.run}>
          {secondary.label}
        </button>
      )}
    </div>
  )
}

function LyricsFooter({ result }: { result: LyricsResult }) {
  const songOffset = useSongOffset()
  const togglePanel = useUi((s) => s.togglePanel)
  const wordByWord = useSettings((s) => s.settings.wordByWord)
  const synced = result.status === 'synced'
  const m = result.matched
  const providerName = result.provider === 'lrclib' ? 'LRCLIB' : result.provider === 'demo' ? 'Demo' : result.provider
  return (
    <div className="lyrics__footer" data-nodrag>
      <span className="lyrics__source">
        <span title={m ? `Matched “${m.title}” by ${m.artist}` : undefined}>
          {providerName}
          <span className="lyrics__kind">
            {synced ? (result.wordSynced ? ' · word-synced' : wordByWord ? ' · words estimated' : ' · line-synced') : ' · plain text'}
            {result.pinned ? ' · your pick' : ''}
          </span>
        </span>
        {result.provider !== 'demo' && (
          <button type="button" className="linkbtn" onClick={() => togglePanel('lyrics')}>
            Wrong lyrics?
          </button>
        )}
      </span>
      {synced && (
        <span className="offset" title="Shift this song's lyrics earlier / later (remembered per song)">
          <button type="button" aria-label="Show lyrics later" onClick={() => nudgeSongOffset(-OFFSET_STEP_MS)}>
            −
          </button>
          <output>{songOffset === 0 ? 'sync' : `${songOffset > 0 ? '+' : ''}${(songOffset / 1000).toFixed(2)}s`}</output>
          <button type="button" aria-label="Show lyrics earlier" onClick={() => nudgeSongOffset(OFFSET_STEP_MS)}>
            +
          </button>
        </span>
      )}
    </div>
  )
}
