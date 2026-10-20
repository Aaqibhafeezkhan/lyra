import { Notification, app, clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { CH, EV, type AppInfo, type LanInfo } from '@shared/ipc'
import type { ConnectionStatus, PlaybackSnapshot, PlayerCommand, Settings, Track, ViewMode } from '@shared/types'
import { getArtwork } from './artwork'
import { DemoSource } from './demo/source'
import { lyricsService } from '@core/lyrics/service'
import { lanViewer } from './lan/server'
import QRCode from 'qrcode'
import { createLogger, readLogTail } from './logger'
import { moments } from './moments'
import { background } from './background/service'
import { youtube } from '@core/background/youtube'
import { failedShortcuts } from './shortcuts'
import { updater } from './updater'
import { settings } from './settings'
import type { PlaybackSource } from './source'
import { SmtcSource } from './smtc/source'
import { SpotifyAuth } from './spotify/auth'
import { SpotifySource } from './spotify/source'
import { TokenStore } from './spotify/tokenStore'
import { windows } from './window'

const log = createLogger('ipc')

export const envClientId = (): string => (process.env['SPOTIFY_CLIENT_ID'] ?? '').trim()
const clientId = (): string => settings.get().spotifyClientId || envClientId()

let spotify: SpotifySource
let demo: DemoSource | null = null
let local: SmtcSource | null = null
let active: PlaybackSource
let lastTrackId: string | null = null

const send = (channel: string, payload: unknown): void => {
  windows.window?.webContents.send(channel, payload)
}

function onSnapshot(s: PlaybackSnapshot): void {
  send(EV.playback, s)
  lanViewer.publish(s)
  const id = s.track?.id ?? null
  if (id && id !== lastTrackId && s.isPlaying && settings.get().trackNotifications && Notification.isSupported()) {
    new Notification({ title: s.track!.title, body: s.track!.artists.join(', '), silent: true }).show()
  }
  lastTrackId = id
}

function onStatus(s: ConnectionStatus): void {
  send(EV.status, s)
}

function activate(src: PlaybackSource): void {
  if (active && active !== src) {
    active.stop()
    active.off('snapshot', onSnapshot)
    active.off('status', onStatus)
  }
  active = src
  lastTrackId = null
  src.on('snapshot', onSnapshot)
  src.on('status', onStatus)
  src.start()
  // Push current state immediately so the renderer never waits for the first poll.
  onStatus(src.getStatus())
  const snap = src.getSnapshot()
  if (snap) onSnapshot(snap)
}

/** Only the app's own window may talk to the main process. */
function guard(e: IpcMainInvokeEvent): void {
  if (e.sender !== windows.window?.webContents) throw new Error('Blocked IPC from unknown sender')
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (e, ...args) => {
    guard(e)
    return fn(...(args as A))
  })
}

function on(channel: string, fn: () => void): void {
  ipcMain.on(channel, (e) => {
    if (e.sender === windows.window?.webContents) fn()
  })
}

const pendingOffers = new Map<string, (a: unknown) => void>()

export function registerIpc(): void {
  lanViewer.onOffer = (offer) =>
    new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2)
      const timer = setTimeout(() => {
        pendingOffers.delete(id)
        resolve(null)
      }, 10_000)
      pendingOffers.set(id, (a) => {
        clearTimeout(timer)
        resolve(a)
      })
      send(EV.lanOffer, { id, offer })
    })
  ipcMain.handle(CH.lanAnswer, (_e, id: string, answer: unknown) => {
    pendingOffers.get(id)?.(answer)
    pendingOffers.delete(id)
  })
  spotify = new SpotifySource(new SpotifyAuth(new TokenStore()), clientId)

  handle(CH.settingsGet, () => settings.get())
  handle(CH.settingsSet, (patch: Partial<Settings>) => {
    const prevId = clientId()
    const prevVolume = settings.get().systemVolume
    const next = settings.update(patch)
    if (next.lanViewer && !lanViewer.running) lanViewer.start()
    else if (!next.lanViewer && lanViewer.running) lanViewer.stop()
    if (active === spotify && clientId() !== prevId) spotify.start()
    if (active === local && local && next.systemVolume !== prevVolume) local.restart()
    return next
  })

  handle(CH.settingsReset, () => {
    const prevVolume = settings.get().systemVolume
    const next = settings.reset()
    background.collectGarbage()
    windows.resetPlacement()
    if (windows.getMode() !== next.defaultMode) windows.setMode(next.defaultMode)
    // default source is the Windows (no-login) one
    local ??= new SmtcSource()
    if (active !== local) activate(local)
    else if (prevVolume !== next.systemVolume) local.restart()
    return next
  })

  handle(CH.windowSetMode, (mode: ViewMode) => {
    if (['minimal', 'compact', 'mini', 'full'].includes(mode)) windows.setMode(mode)
  })
  handle(CH.windowGetMode, () => windows.getMode())
  on(CH.windowDragStart, () => windows.dragStart())
  on(CH.windowDragMove, () => windows.dragMove())
  on(CH.windowDragEnd, () => windows.dragEnd())
  on(CH.windowResizeStart, () => windows.resizeStart())
  on(CH.windowResizeMove, () => windows.resizeMove())
  on(CH.windowResizeEnd, () => windows.resizeEnd())
  on(CH.windowSettle, () => windows.settle())
  on(CH.windowHide, () => windows.hide())
  on(CH.windowMinimize, () => windows.minimize())
  on(CH.windowQuit, () => app.quit())

  handle(CH.spotifyConnect, async (id?: string) => {
    if (typeof id === 'string' && id.trim()) settings.update({ spotifyClientId: id.trim() })
    settings.update({ source: 'api' })
    if (active !== spotify) activate(spotify)
    await spotify.connect()
    return spotify.getStatus()
  })
  handle(CH.spotifyDisconnect, () => {
    spotify.disconnect()
    local ??= new SmtcSource()
    settings.update({ source: 'local' })
    activate(local)
  })
  handle(CH.spotifyLocal, () => {
    settings.update({ source: 'local' })
    local ??= new SmtcSource()
    activate(local)
  })
  handle(CH.spotifyDemo, () => {
    demo ??= new DemoSource()
    activate(demo)
  })
  handle(CH.spotifyStatus, () => active.getStatus())
  handle(CH.spotifySnapshot, () => active.getSnapshot())

  handle(CH.playerCommand, (cmd: PlayerCommand) => active.command(cmd))
  handle(CH.playerLikeGet, (id: string) => active.isLiked(id))
  handle(CH.playerLikeSet, (id: string, liked: boolean) => active.setLiked(id, liked))
  handle(CH.playerQueue, () => active.queue())
  handle(CH.playerRecent, () => active.recent())
  handle(CH.playerOpen, async (t: Track | null) => {
    if (!t) return void (await shell.openExternal('spotify:'))
    const url = t.webUrl
    if (url && /^https:\/\/open\.spotify\.com\//.test(url)) await shell.openExternal(url)
    else if (/^spotify:(track|episode):[A-Za-z0-9]+$/.test(t.uri)) await shell.openExternal(t.uri)
  })

  handle(CH.lyricsGet, (t: Track) => lyricsService.get(t))
  handle(CH.lyricsRefresh, (t: Track) => lyricsService.get(t, true))
  handle(CH.lyricsCandidates, (t: Track) => lyricsService.candidates(t))
  handle(CH.lyricsChoose, (t: Track, provider: string, id: string) => lyricsService.choose(t, provider, id))
  handle(CH.lyricsClearPin, (t: Track) => lyricsService.clearPin(t))
  handle(CH.artGet, (url: string) => getArtwork(url))

  handle(CH.momentsList, () => moments.list())
  handle(CH.momentsAdd, (m: Parameters<typeof moments.add>[0]) => moments.add(m))
  handle(CH.momentsRemove, (id: string) => moments.remove(id))

  handle(CH.appDiagnostics, (): string => {
    const { spotifyClientId: _id, position, ...safe } = settings.get()
    void _id
    return [
      `Lyra ${app.getVersion()} (${app.isPackaged ? 'installed' : 'dev'})`,
      `Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`,
      `Windows ${process.getSystemVersion()} · ${process.arch}`,
      `Source: ${active?.kind ?? 'none'} · status: ${JSON.stringify(active?.getStatus() ?? {})}`,
      `Settings: ${JSON.stringify({ ...safe, position: position ? 'set' : null })}`,
      '--- recent log ---',
      readLogTail(80)
    ].join('\n')
  })
  handle(CH.appShortcutStatus, () => failedShortcuts())
  handle(CH.appCopy, (text: string) => {
    if (typeof text !== 'string' || text.length > 200_000) return false
    clipboard.writeText(text)
    return true
  })
  handle(CH.bgResolve, (t: Track) => background.resolve(t))
  handle(CH.bgPick, (scope: 'song' | 'global', trackId?: string) => background.pick(scope === 'song' ? 'song' : 'global', trackId))
  handle(CH.bgClear, (scope: 'song' | 'global', trackId?: string) => background.clear(scope === 'song' ? 'song' : 'global', trackId))
  handle(CH.bgKeyHas, () => youtube.hasKey())
  handle(CH.bgKeySet, (key: string) => youtube.setKey(String(key)))
  handle(CH.bgKeyClear, () => youtube.clearKey())
  handle(CH.bgYtCandidates, (t: Track) => youtube.candidates(t))
  handle(CH.bgYtChoose, async (trackId: string, videoId: string | null) => {
    if (videoId === null) return background.chooseYoutube(trackId, null)
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return
    background.chooseYoutube(trackId, { videoId, title: '', channel: '', durationSec: null })
  })
  handle(CH.updateGet, () => updater.state)
  handle(CH.updateCheck, () => updater.check())
  handle(CH.updateInstall, () => updater.install())
  updater.on('state', (st) => send(EV.update, st))
  handle(CH.lanInfo, async (): Promise<LanInfo> => {
    const urls = lanViewer.urls()
    const qr = urls[0] ? await QRCode.toDataURL(urls[0], { margin: 1, width: 240, color: { dark: '#0a0a0a', light: '#ffffff' } }) : null
    return { running: lanViewer.running, urls, qr }
  })
  handle(CH.appInfo, (): AppInfo => ({ version: app.getVersion(), platform: process.platform, envClientId: !!envClientId() }))

  settings.on('change', (next: Settings) => {
    send(EV.settings, next)
    windows.applySettings(next)
  })
}

export function startPlayback(): void {
  if (settings.get().source === 'api') return activate(spotify)
  local ??= new SmtcSource()
  activate(local)
}

export function setBackground(hidden: boolean): void {
  active?.setBackground(hidden)
}

export function disposePlayback(): void {
  active?.stop()
  log.info('playback stopped')
}
