import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The karaoke video as a clock: a YouTube embed that we play, pause and seek through its message API, and read the
 * current time from. Time between two messages (about 4 a second) is interpolated, so lyrics move smoothly.
 */
const ORIGIN = 'https://www.youtube-nocookie.com'

export interface KaraokePlayer {
  /** attach to the iframe */
  frame: React.RefObject<HTMLIFrameElement | null>
  src: string
  ready: boolean
  playing: boolean
  /** seconds, interpolated; 0 until the player reports */
  now(): number
  /** read the current state (the fields above belong to one render; these never go stale) */
  isPlaying(): boolean
  length(): number
  duration: number
  play(): void
  pause(): void
  seek(sec: number): void
  onLoad(): void
}

export function useKaraokePlayer(videoId: string | null): KaraokePlayer {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const last = useRef({ t: 0, at: 0, playing: false })
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const durationRef = useRef(0)

  const cmd = useCallback((func: string, args: unknown[] = []): void => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), ORIGIN)
  }, [])

  useEffect(() => {
    setReady(false)
    setPlaying(false)
    last.current = { t: 0, at: 0, playing: false }
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow || e.origin !== ORIGIN) return
      let d: { event?: string; info?: { currentTime?: number; playerState?: number; duration?: number } } | null = null
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      const info = d?.info
      if (d?.event === 'onReady') setReady(true)
      if (!info) return
      if (typeof info.currentTime === 'number') last.current = { ...last.current, t: info.currentTime, at: performance.now() }
      if (typeof info.duration === 'number' && info.duration > 0) {
        durationRef.current = info.duration
        setDuration(info.duration)
      }
      if (typeof info.playerState === 'number') {
        const p = info.playerState === 1
        last.current = { ...last.current, playing: p, t: last.current.t, at: performance.now() }
        setPlaying(p)
        setReady(true)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [videoId])

  return {
    frame,
    src: videoId ? `${ORIGIN}/embed/${videoId}?controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&fs=0&iv_load_policy=3&enablejsapi=1` : '',
    ready,
    playing,
    duration,
    isPlaying: () => last.current.playing,
    length: () => durationRef.current,
    now: () => {
      const l = last.current
      return l.playing ? l.t + (performance.now() - l.at) / 1000 : l.t
    },
    play: () => cmd('playVideo'),
    pause: () => cmd('pauseVideo'),
    seek: (sec: number) => {
      cmd('seekTo', [Math.max(0, sec), true])
      last.current = { ...last.current, t: Math.max(0, sec), at: performance.now() }
    },
    onLoad: () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), ORIGIN)
  }
}

/** A YouTube address or a bare id -> the 11-character video id (or null). */
export function parseVideoId(text: string): string | null {
  const t = text.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t
  const m = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(t)
  return m ? m[1]! : null
}
