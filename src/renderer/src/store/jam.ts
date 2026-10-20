import { create } from 'zustand'
import Peer, { type DataConnection } from 'peerjs'
import { getPosition, usePlayer } from './player'

/**
 * Jam: join someone's room from the Lyra app and listen in sync. Everyone plays the same song in their own
 * player; Lyra matches the host's play/pause and position (like Syncplay for movies). No audio travels
 * between devices, so there is no streaming delay and nothing is rebroadcast.
 */
const PREFIX = 'lyra-room-'

interface HostState {
  trackId: string
  title: string
  artists: string
  durationMs: number
  playing: boolean
  positionMs: number
  at: number // host clock when positionMs was sampled
}

interface JamStore {
  code: string | null
  status: 'idle' | 'joining' | 'connected' | 'ended' | 'error'
  message: string | null
  host: HostState | null
  /** The host's song is not what is playing here: show "play this". */
  needSong: { title: string; artists: string } | null
  syncing: boolean
  syncOn: boolean
  setSync(on: boolean): void
  join(codeOrLink: string): void
  leave(): void
}

let peer: Peer | null = null
let conn: DataConnection | null = null
let skew = 0 // host clock minus this device's clock
let loop: ReturnType<typeof setInterval> | undefined
let ping: ReturnType<typeof setInterval> | undefined
let watchdog: ReturnType<typeof setInterval> | undefined
let lastMsg = 0
let lastSeek = 0
let lastToggle = 0

export function parseRoomCode(input: string): string | null {
  const t = input.trim()
  const fromLink = /[?&]r=([A-Za-z0-9]{4,12})/.exec(t)?.[1]
  const raw = (fromLink ?? t).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw.length >= 4 && raw.length <= 12 ? raw : null
}

/** "Levitating (feat. DaBaby)" and "levitating" are the same song. */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[([].*?[)\]]/g, ' ')
    .replace(/\b(feat|ft|with|remaster(ed)?|version|live|radio edit)\b.*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

function sameSong(h: HostState, t: { title: string; artists: string[] }): boolean {
  const a = norm(h.title)
  const b = norm(t.title)
  if (!a || !b || (a !== b && !a.startsWith(b) && !b.startsWith(a))) return false
  const ha = norm(h.artists)
  const la = norm(t.artists[0] ?? '')
  return !la || ha.includes(la) || la.includes(ha.split(' ')[0] ?? '')
}

function hostPosition(h: HostState): number {
  const now = Date.now() + skew
  return Math.max(0, h.positionMs + (h.playing ? now - h.at : 0))
}

function stopLoops(): void {
  clearInterval(loop)
  clearInterval(ping)
  clearInterval(watchdog)
  loop = ping = watchdog = undefined
}

function teardown(): void {
  stopLoops()
  try {
    conn?.close()
  } catch {
    /* already closed */
  }
  peer?.destroy()
  conn = null
  peer = null
}

export const useJam = create<JamStore>((set, get) => {
  /** One sync step: match play/pause, then correct drift. */
  function step(): void {
    const { host, syncOn } = get()
    if (!host || !host.trackId) return set({ needSong: null, syncing: false })
    const snap = usePlayer.getState().snapshot
    const track = snap?.track
    if (!track || !sameSong(host, track)) {
      if (!get().needSong || get().needSong!.title !== host.title) set({ needSong: { title: host.title, artists: host.artists }, syncing: false })
      return
    }
    if (get().needSong) set({ needSong: null })
    if (!syncOn) return set({ syncing: false })
    const cmd = usePlayer.getState().command
    const now = Date.now()
    if (host.playing !== !!snap.isPlaying) {
      if (now - lastToggle > 2500) {
        lastToggle = now
        void cmd({ type: host.playing ? 'play' : 'pause' })
      }
      return set({ syncing: true })
    }
    if (host.playing) {
      const drift = getPosition() - hostPosition(host)
      if (Math.abs(drift) > 800 && now - lastSeek > 5000) {
        lastSeek = now
        // aim a little ahead: the seek takes a moment to land
        void cmd({ type: 'seek', positionMs: Math.min(track.durationMs - 100, Math.round(hostPosition(host) + 150)) })
        return set({ syncing: true })
      }
    }
    set({ syncing: false })
  }

  function onData(d: unknown): void {
    const m = d as { t?: string } & Partial<HostState> & { c?: number; h?: number }
    lastMsg = Date.now()
    if (m.t === 'pong' && typeof m.c === 'number' && typeof m.h === 'number') {
      const rtt = Date.now() - m.c
      skew = m.h + rtt / 2 - Date.now()
    } else if (m.t === 'state') {
      set({ host: { trackId: m.trackId ?? '', title: m.title ?? '', artists: m.artists ?? '', durationMs: m.durationMs ?? 0, playing: !!m.playing, positionMs: m.positionMs ?? 0, at: m.at ?? Date.now() } })
      step()
    } else if (m.t === 'bye') {
      end('The host closed the room.')
    }
  }

  function end(message: string): void {
    teardown()
    set({ status: 'ended', message, host: null, needSong: null, syncing: false })
  }

  return {
    code: null,
    status: 'idle',
    message: null,
    host: null,
    needSong: null,
    syncing: false,
    syncOn: true,
    setSync(on) {
      set({ syncOn: on })
      if (on) step()
    },
    join(input) {
      const code = parseRoomCode(input)
      if (!code) return set({ status: 'error', message: 'That doesn’t look like a room code or link.' })
      teardown()
      set({ code, status: 'joining', message: null, host: null, needSong: null })
      const p = new Peer({ debug: 0 })
      peer = p
      p.on('open', () => {
        const c = p.connect(PREFIX + code, { reliable: true })
        conn = c
        c.on('open', () => {
          lastMsg = Date.now()
          set({ status: 'connected', message: null })
          c.send({ t: 'hello' })
          const doPing = (): void => {
            if (c.open) c.send({ t: 'ping', c: Date.now() })
          }
          doPing()
          ping = setInterval(doPing, 8000)
          loop = setInterval(step, 1000)
          watchdog = setInterval(() => {
            if (Date.now() - lastMsg > 16_000) end('Lost the connection to the host.')
          }, 3000)
        })
        c.on('data', onData)
        c.on('close', () => get().status === 'connected' && end('The host closed the room.'))
      })
      p.on('error', (e) => {
        teardown()
        set({
          status: 'error',
          message: e.type === 'peer-unavailable' ? 'That room isn’t open (anymore). Ask for a fresh link.' : 'Couldn’t connect. Check your internet connection.'
        })
      })
    },
    leave() {
      teardown()
      set({ code: null, status: 'idle', message: null, host: null, needSong: null, syncing: false })
    }
  }
})
