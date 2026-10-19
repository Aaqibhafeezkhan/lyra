import { thumbCrop, type DecodedImage } from '@core/background/bars'
import { createBackgroundResolver, type SongBg } from '@core/background/resolver'
import { youtube } from '@core/background/youtube'
import { lyricsService } from '@core/lyrics/service'
import type { LyraApi, Unsubscribe } from '@shared/ipc'
import { DEFAULT_SETTINGS, type ConnectionStatus, type ModeEvent, type PlaybackSnapshot, type SavedMoment, type Settings, type ViewMode } from '@shared/types'
import { installAndroidPlatform, LocalStore, preloadSecrets, setAppVersion } from './platform'
import { nativeFetch, rpc } from './rpc'

/**
 * Android's implementation of `window.lyra`: the same surface the Windows preload exposes, so the React UI runs
 * unchanged. Lyrics and backgrounds use the shared core; playback and the OS come from the app through `rpc`.
 */

installAndroidPlatform()
void rpc<string>('version').then(setAppVersion).catch(() => undefined)
/** resolves once secrets are loaded; the UI starts after this */
export const ready: Promise<void> = preloadSecrets(['youtube-key'])

function emitter<T>(): { on(cb: (v: T) => void): Unsubscribe; emit(v: T): void } {
  const set = new Set<(v: T) => void>()
  return {
    on(cb) {
      set.add(cb)
      return () => set.delete(cb)
    },
    emit(v) {
      set.forEach((cb) => cb(v))
    }
  }
}

// ---------------- settings
const settingsStore = new LocalStore<Settings>('settings', {
  ...DEFAULT_SETTINGS,
  // phone defaults: no desktop welcome card, the expanded player is the home screen, and the video belongs in it
  onboarded: true,
  defaultMode: 'mini',
  backgroundInMini: true
})
const settingsChanged = emitter<Settings>()

function sanitize(s: Settings): Settings {
  const clamp = (n: unknown, lo: number, hi: number, d: number): number => (typeof n === 'number' && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d)
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    backgroundInMini: true, // the phone's only player always shows the video
    backgroundDim: clamp(s.backgroundDim, 0.2, 0.9, 0.5),
    lyricFontSize: clamp(s.lyricFontSize, 24, 72, 40),
    lineSpacing: clamp(s.lineSpacing, 1, 2, 1.35),
    lyricOffsetMs: clamp(s.lyricOffsetMs, -3000, 3000, 0),
    onboarded: true
  }
}

// ---------------- phone switches (screen stays on while playing / background service)
let lastScreenOn: boolean | null = null
let lastRunning: boolean | null = null
function syncPhone(): void {
  if (overlayMode) return // the floating widget never touches the screen / service switches
  const s = settingsStore.get()
  const screenOn = !!s.keepScreenOn && !!snapshot?.isPlaying
  if (screenOn !== lastScreenOn) {
    lastScreenOn = screenOn
    void rpc('keepScreenOn', screenOn).catch(() => undefined)
  }
  if (!!s.keepRunning !== lastRunning) {
    lastRunning = !!s.keepRunning
    void rpc('keepRunning', lastRunning).catch(() => undefined)
  }
}

// ---------------- window / mode (the phone has one screen: expanded player or the full cinema layout)
/** the floating widget runs this same page with ?overlay=compact */
const overlayMode = new URLSearchParams(location.search).get('overlay')
let mode: ViewMode = overlayMode ? 'compact' : 'mini'
const modeChanged = emitter<ModeEvent>()

// ---------------- playback (pushed by the app)
let snapshot: PlaybackSnapshot | null = null
let status: ConnectionStatus = { state: 'offline', message: 'Starting…' }
const playbackChanged = emitter<PlaybackSnapshot>()
const statusChanged = emitter<ConnectionStatus>()

function receive(snapJson: string, statusJson: string): void {
  try {
    const st = JSON.parse(statusJson) as ConnectionStatus
    if (JSON.stringify(st) !== JSON.stringify(status)) {
      status = st
      statusChanged.emit(st)
    }
    const snap = JSON.parse(snapJson) as PlaybackSnapshot | null
    snapshot = snap
    if (snap) playbackChanged.emit(snap)
    syncPhone()
  } catch (e) {
    console.warn('bad native push', e)
  }
}

// ---------------- artwork / moments / backgrounds
const artCache = new Map<string, string | null>()
async function artDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url
  if (artCache.has(url)) return artCache.get(url) ?? null
  try {
    const res = await nativeFetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const data = await new Promise<string>((ok, bad) => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.onerror = () => bad(r.error)
      r.readAsDataURL(blob)
    })
    artCache.set(url, data)
    return data
  } catch {
    artCache.set(url, null)
    return null
  }
}

const momentsStore = new LocalStore<{ items: SavedMoment[] }>('moments', { items: [] })
const songsStore = new LocalStore<{ songs: Record<string, SongBg> }>('backgrounds', { songs: {} })

const b64url = (s: string): string => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Decode a thumbnail through a canvas so the shared core can look for black bars. */
async function decodeThumb(bytes: ArrayBuffer): Promise<DecodedImage | null> {
  const bmp = await createImageBitmap(new Blob([bytes]))
  const c = new OffscreenCanvas(160, 90)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bmp, 0, 0, 160, 90)
  const d = ctx.getImageData(0, 0, 160, 90)
  return { width: 160, height: 90, pixels: d.data, order: 'rgba' }
}

const resolveBackground = createBackgroundResolver({
  settings: () => settingsStore.get(),
  songs: () => songsStore.get().songs,
  mediaSpec: (m, scope) => ({ kind: 'media', url: `${location.origin}/bg/${m.file}`, media: m.kind, name: m.name, scope }),
  clipUrl: (url) => `${location.origin}/preview/${b64url(url)}`,
  crop: (videoId) => thumbCrop(videoId, decodeThumb)
})

const noop = (): void => undefined

/** Delete a picked file once nothing refers to it any more. */
function dropIfUnused(file: string): void {
  const used = settingsStore.get().customBackground?.file === file || Object.values(songsStore.get().songs).some((s) => s.media?.file === file)
  if (!used) void rpc('mediaDelete', file).catch(() => undefined)
}

/** One quiet retry when the free lyrics service hiccups (the app and the floating widget can ask at the same moment). */
async function withRetry<T extends { status: string }>(first: () => Promise<T>, again: () => Promise<T>): Promise<T> {
  const r = await first()
  if (r.status !== 'error') return r
  await new Promise((ok) => setTimeout(ok, 3000))
  return again()
}

export const androidApi: LyraApi & { android: NonNullable<LyraApi['android']> } = {
  settings: {
    get: async () => sanitize(settingsStore.get()),
    set: async (patch) => {
      const next = sanitize({ ...settingsStore.get(), ...patch })
      settingsStore.set(next)
      settingsChanged.emit(next)
      syncPhone()
      return next
    },
    reset: async () => {
      const next = sanitize({ ...DEFAULT_SETTINGS, defaultMode: 'mini', backgroundInMini: true })
      settingsStore.set(next)
      settingsChanged.emit(next)
      return next
    },
    onChange: settingsChanged.on
  },
  window: {
    setMode: async (m) => {
      if (overlayMode) {
        // the floating widget can only be a widget; "expand" opens the app
        if (m !== 'compact' && m !== 'minimal') void rpc('openApp')
        return
      }
      // the phone only has two layouts: the expanded player ("mini") and the cinema layout ("full")
      const next: ViewMode = 'mini' // the phone has one player: the video-first one
      if (next === mode) return
      mode = next
      modeChanged.emit({ mode })
    },
    getMode: async () => mode,
    onMode: modeChanged.on,
    onFade: () => noop,
    settle: noop,
    resizeStart: noop,
    resizeMove: noop,
    resizeEnd: noop,
    dragStart: noop,
    dragMove: noop,
    dragEnd: noop,
    hide: () => void rpc('minimize'),
    minimize: () => void rpc('minimize'),
    quit: () => void rpc('finish')
  },
  spotify: {
    connect: async () => status,
    disconnect: async () => undefined,
    startDemo: async () => undefined,
    useLocal: async () => undefined,
    getStatus: async () => {
      status = JSON.parse(await rpc<string>('status')) as ConnectionStatus
      return status
    },
    getSnapshot: async () => {
      snapshot = JSON.parse(await rpc<string>('snapshot')) as PlaybackSnapshot | null
      return snapshot
    },
    onStatus: statusChanged.on,
    onPlayback: playbackChanged.on
  },
  player: {
    command: async (cmd) => {
      const ok = await rpc<boolean>('command', JSON.stringify(cmd))
      return ok ? { ok: true } : { ok: false, reason: 'unsupported', error: 'Nothing is playing, or that app doesn’t allow this control.' }
    },
    isLiked: async () => null,
    setLiked: async () => ({ ok: false, reason: 'unsupported', error: 'Saving to Liked Songs isn’t available on Android yet.' }),
    queue: async () => null,
    recent: async () => null,
    openInSpotify: async () => void (await rpc('openSpotify'))
  },
  lyrics: {
    get: (t) => withRetry(() => lyricsService.get(t), () => lyricsService.get(t, true)),
    refresh: (t) => lyricsService.get(t, true),
    candidates: (t) => lyricsService.candidates(t),
    choose: (t, provider, id) => lyricsService.choose(t, provider, id),
    clearPin: (t) => lyricsService.clearPin(t)
  },
  art: { get: artDataUrl },
  moments: {
    list: async () => momentsStore.get().items,
    add: async (m) => {
      const items = momentsStore.get().items
      if (items.some((x) => x.trackId === m.trackId && x.text === m.text)) return items
      const next = [{ ...m, id: crypto.randomUUID(), savedAt: Date.now() }, ...items].slice(0, 500)
      momentsStore.set({ items: next })
      return next
    },
    remove: async (id) => {
      const next = momentsStore.get().items.filter((x) => x.id !== id)
      momentsStore.set({ items: next })
      return next
    }
  },
  background: {
    resolve: (t) => resolveBackground(t),
    pick: async (scope, trackId) => {
      if (scope === 'song' && !trackId) return { ok: false, error: 'No song selected.' }
      const r = await rpc<{ ok: boolean; file?: string; name?: string; kind?: 'video' | 'image'; error?: string }>('pickMedia')
      if (!r.ok || !r.file || !r.name || !r.kind) return { ok: false, error: r.error }
      const media = { file: r.file, name: r.name, kind: r.kind }
      if (scope === 'global') {
        const old = settingsStore.get().customBackground
        const next = sanitize({ ...settingsStore.get(), customBackground: media })
        settingsStore.set(next)
        settingsChanged.emit(next)
        if (old) dropIfUnused(old.file)
      } else {
        const songs = { ...songsStore.get().songs }
        const old = songs[trackId!]?.media
        songs[trackId!] = { ...songs[trackId!], media }
        songsStore.set({ songs })
        if (old) dropIfUnused(old.file)
      }
      return { ok: true }
    },
    clear: async (scope, trackId) => {
      if (scope === 'global') {
        const old = settingsStore.get().customBackground
        const next = sanitize({ ...settingsStore.get(), customBackground: null })
        settingsStore.set(next)
        settingsChanged.emit(next)
        if (old) dropIfUnused(old.file)
      } else if (trackId) {
        const songs = { ...songsStore.get().songs }
        const old = songs[trackId]?.media
        if (songs[trackId]) {
          const { media: _gone, ...rest } = songs[trackId]!
          void _gone
          if (rest.youtube) songs[trackId] = rest
          else delete songs[trackId]
          songsStore.set({ songs })
        }
        if (old) dropIfUnused(old.file)
      }
    },
    hasYoutubeKey: async () => youtube.hasKey(),
    setYoutubeKey: (k) => youtube.setKey(k),
    clearYoutubeKey: async () => youtube.clearKey(),
    youtubeCandidates: (t) => youtube.candidates(t),
    youtubeChoose: async (trackId, videoId) => {
      const songs = { ...songsStore.get().songs }
      if (videoId) songs[trackId] = { ...songs[trackId], youtube: { videoId, title: '', channel: '', durationSec: null } }
      else if (songs[trackId]) {
        const { youtube: _gone, ...rest } = songs[trackId]!
        void _gone
        if (rest.media) songs[trackId] = rest
        else delete songs[trackId]
      }
      songsStore.set({ songs })
    }
  },
  update: {
    get: async () => ({ state: 'disabled', reason: 'Download new versions from the GitHub releases page.' }),
    check: async () => undefined,
    install: async () => undefined,
    onState: () => noop
  },
  app: {
    info: async () => ({ version: await rpc<string>('version'), platform: 'android', envClientId: false }),
    diagnostics: async () => `Lyra for Android ${await rpc<string>('version')}\n${navigator.userAgent}\nstatus: ${JSON.stringify(status)}`,
    copy: async (text) => rpc<boolean>('copy', text),
    failedShortcuts: async () => [],
    onCommand: () => noop
  },
  android: {
    hasAccess: () => rpc<boolean>('hasAccess'),
    openAccessSettings: async () => void (await rpc('openAccessSettings')),
    openBatterySettings: async () => void (await rpc('openBatterySettings')),
    overlayState: () => rpc<{ enabled: boolean; canDraw: boolean }>('overlayState'),
    lyricsNotification: () => rpc<{ enabled: boolean; public: boolean }>('lyricsNotificationState'),
    setLyricsNotification: async (on, showOnLockScreen) => void (await rpc('lyricsNotification', on, showOnLockScreen)),
    openAmbient: async () => void (await rpc('openAmbient')),
    toggleAmbient: async () => void (await rpc('toggleAmbient')),
    addAmbientTile: () => rpc<boolean>('addAmbientTile'),
    setOverlay: (on) => rpc<{ ok: boolean; needsPermission?: boolean }>('overlaySet', on)
  }
}

window.lyra = androidApi
syncPhone()
window.__lyraNative = {
  push: receive,
  back: () => false // replaced by entry.ts once the UI stores exist
}
