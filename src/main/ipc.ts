import { Notification, app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { CH, EV, type AppInfo } from '@shared/ipc'
import type { ConnectionStatus, PlaybackSnapshot, PlayerCommand, Settings, Track, ViewMode } from '@shared/types'
import { getArtwork } from './artwork'
import { DemoSource } from './demo/source'
import { lyricsService } from './lyrics/service'
import { createLogger } from './logger'
import { moments } from './moments'
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

export function registerIpc(): void {
  spotify = new SpotifySource(new SpotifyAuth(new TokenStore()), clientId)

  handle(CH.settingsGet, () => settings.get())
  handle(CH.settingsSet, (patch: Partial<Settings>) => {
    const prevId = clientId()
    const next = settings.update(patch)
    if (active === spotify && clientId() !== prevId) spotify.start()
    void prevId
    return next
  })

  handle(CH.windowSetMode, (mode: ViewMode) => {
    if (['minimal', 'compact', 'mini', 'full'].includes(mode)) windows.setMode(mode)
  })
  handle(CH.windowGetMode, () => windows.getMode())
  on(CH.windowDragStart, () => windows.dragStart())
  on(CH.windowDragMove, () => windows.dragMove())
  on(CH.windowDragEnd, () => windows.dragEnd())
  on(CH.windowHide, () => windows.hide())
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
  handle(CH.artGet, (url: string) => getArtwork(url))

  handle(CH.momentsList, () => moments.list())
  handle(CH.momentsAdd, (m: Parameters<typeof moments.add>[0]) => moments.add(m))
  handle(CH.momentsRemove, (id: string) => moments.remove(id))

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
