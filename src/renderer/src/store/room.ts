import { create } from 'zustand'
import Peer, { type DataConnection } from 'peerjs'
import { getPosition, usePlayer } from './player'
import { useLyrics } from './lyrics'

/**
 * "Listen together": the host shares what is playing (title, position, synced lyrics) with anyone who opens the
 * room link in a browser. It is a direct browser-to-browser connection (WebRTC); the public PeerJS broker only
 * introduces the two sides. Audio is NOT shared: everyone plays the song themselves, or just reads along.
 */
export const ROOM_SITE = 'https://lyra-website-rho.vercel.app'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
const PREFIX = 'lyra-room-'

type Msg =
  | { t: 'state'; trackId: string; title: string; artists: string; durationMs: number; playing: boolean; positionMs: number; at: number }
  | { t: 'art'; trackId: string; src: string }
  | { t: 'lyrics'; trackId: string; status: string; lines: Array<{ timeMs: number; text: string }> }
  | { t: 'bye' }

interface RoomStore {
  code: string | null
  guests: number
  state: 'idle' | 'starting' | 'live' | 'error'
  error: string | null
  start(): void
  stop(): void
}

let peer: Peer | null = null
let conns = new Set<DataConnection>()
let timer: ReturnType<typeof setInterval> | undefined
let unsub: (() => void) | undefined
let unsubLyrics: (() => void) | undefined
let lastSent = { id: '', playing: false, pos: 0, at: 0 }

function newCode(): string {
  let s = ''
  const r = crypto.getRandomValues(new Uint8Array(6))
  for (const b of r) s += ALPHABET[b % ALPHABET.length]
  return s
}

function stateMsg(): Msg {
  const s = usePlayer.getState().snapshot
  const t = s?.track
  return {
    t: 'state',
    trackId: t?.id ?? '',
    title: t?.title ?? '',
    artists: t?.artists.join(', ') ?? '',
    durationMs: t?.durationMs ?? 0,
    playing: !!s?.isPlaying,
    positionMs: Math.round(getPosition()),
    at: Date.now()
  }
}

function lyricsMsg(): Msg | null {
  const t = usePlayer.getState().snapshot?.track
  const l = useLyrics.getState().state
  if (!t || l.phase !== 'ready' || l.result.trackId !== t.id) return null
  return { t: 'lyrics', trackId: t.id, status: l.result.status, lines: l.result.lines.map((x) => ({ timeMs: x.timeMs, text: x.text })) }
}

function artMsg(): Msg | null {
  const t = usePlayer.getState().snapshot?.track
  if (!t?.artworkUrl) return null
  // a data: URL from Windows media controls can be large; only share small ones
  if (t.artworkUrl.startsWith('data:') && t.artworkUrl.length > 180_000) return null
  return { t: 'art', trackId: t.id, src: t.artworkUrl }
}

function sendAll(m: Msg | null): void {
  if (!m) return
  for (const c of conns) if (c.open) c.send(m)
}

function sendTo(c: DataConnection): void {
  c.send(stateMsg())
  const a = artMsg()
  if (a) c.send(a)
  const l = lyricsMsg()
  if (l) c.send(l)
}

/** Send a fresh state when something meaningful changed: new song, play/pause, or a seek. */
function tick(force = false): void {
  const m = stateMsg() as Extract<Msg, { t: 'state' }>
  const expected = lastSent.playing ? lastSent.pos + (m.at - lastSent.at) : lastSent.pos
  const jumped = Math.abs(m.positionMs - expected) > 1500
  const changed = m.trackId !== lastSent.id || m.playing !== lastSent.playing || jumped
  if (!force && !changed) return
  if (m.trackId !== lastSent.id) {
    sendAll(m)
    sendAll(artMsg())
    sendAll(lyricsMsg())
  } else sendAll(m)
  lastSent = { id: m.trackId, playing: m.playing, pos: m.positionMs, at: m.at }
}

export const useRoom = create<RoomStore>((set, get) => ({
  code: null,
  guests: 0,
  state: 'idle',
  error: null,

  start() {
    if (get().state === 'starting' || get().state === 'live') return
    const code = newCode()
    set({ code, state: 'starting', error: null, guests: 0 })
    const p = new Peer(PREFIX + code, { debug: 0 })
    peer = p
    p.on('open', () => {
      set({ state: 'live' })
      timer = setInterval(() => tick(true), 5000) // heartbeat keeps late joiners and clocks honest
      unsub = usePlayer.subscribe(() => tick())
      // lyrics arrive a moment after the song changes: send them as soon as they are ready
      let lastLy = ''
      unsubLyrics = useLyrics.subscribe(() => {
        const m = lyricsMsg()
        const key = m && m.t === 'lyrics' ? m.trackId + m.status + m.lines.length : ''
        if (m && key !== lastLy) {
          lastLy = key
          sendAll(m)
        }
      })
    })
    p.on('connection', (c) => {
      c.on('open', () => {
        conns.add(c)
        set({ guests: conns.size })
        sendTo(c)
      })
      c.on('data', (d) => {
        const m = d as { t?: string; c?: number }
        if (m && m.t === 'ping') c.send({ t: 'pong', c: m.c, h: Date.now() })
        if (m && m.t === 'hello') sendTo(c)
      })
      const gone = (): void => {
        conns.delete(c)
        set({ guests: conns.size })
      }
      c.on('close', gone)
      c.on('error', gone)
    })
    p.on('error', (e) => {
      // an id clash is vanishingly rare; anything else (offline, broker down) is shown to the user
      get().stop()
      set({ state: 'error', error: e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Couldn’t reach the room service. Check your internet connection.' : `Room error: ${e.type}` })
    })
    p.on('disconnected', () => {
      if (get().state === 'live') p.reconnect()
    })
  },

  stop() {
    if (timer) clearInterval(timer)
    unsub?.()
    unsubLyrics?.()
    timer = undefined
    unsub = undefined
    unsubLyrics = undefined
    // tell guests first so their screens clear right away, then close once the message has been sent
    const closing = conns
    const p = peer
    for (const c of closing) if (c.open) c.send({ t: 'bye' } satisfies Msg)
    conns = new Set()
    peer = null
    setTimeout(() => {
      for (const c of closing) c.close()
      p?.destroy()
    }, 400)
    lastSent = { id: '', playing: false, pos: 0, at: 0 }
    set({ code: null, guests: 0, state: 'idle', error: null })
  }
}))

export const roomLink = (code: string): string => `${ROOM_SITE}/room?r=${code}`
