import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH, EV, type LyraApi, type Unsubscribe } from '@shared/ipc'

const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...args) as Promise<T>

function subscribe<T>(ch: string, cb: (v: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(ch, listener)
  return () => ipcRenderer.removeListener(ch, listener)
}

const api: LyraApi = {
  settings: {
    get: () => invoke(CH.settingsGet),
    set: (patch) => invoke(CH.settingsSet, patch),
    onChange: (cb) => subscribe(EV.settings, cb)
  },
  window: {
    setMode: (mode) => invoke(CH.windowSetMode, mode),
    getMode: () => invoke(CH.windowGetMode),
    onMode: (cb) => subscribe(EV.mode, cb),
    dragStart: () => ipcRenderer.send(CH.windowDragStart),
    dragMove: () => ipcRenderer.send(CH.windowDragMove),
    dragEnd: () => ipcRenderer.send(CH.windowDragEnd),
    settle: () => ipcRenderer.send(CH.windowSettle),
    resizeStart: () => ipcRenderer.send(CH.windowResizeStart),
    resizeMove: () => ipcRenderer.send(CH.windowResizeMove),
    resizeEnd: () => ipcRenderer.send(CH.windowResizeEnd),
    hide: () => ipcRenderer.send(CH.windowHide),
    minimize: () => ipcRenderer.send(CH.windowMinimize),
    quit: () => ipcRenderer.send(CH.windowQuit)
  },
  spotify: {
    connect: (clientId) => invoke(CH.spotifyConnect, clientId),
    disconnect: () => invoke(CH.spotifyDisconnect),
    startDemo: () => invoke(CH.spotifyDemo),
    useLocal: () => invoke(CH.spotifyLocal),
    getStatus: () => invoke(CH.spotifyStatus),
    getSnapshot: () => invoke(CH.spotifySnapshot),
    onStatus: (cb) => subscribe(EV.status, cb),
    onPlayback: (cb) => subscribe(EV.playback, cb)
  },
  player: {
    command: (cmd) => invoke(CH.playerCommand, cmd),
    isLiked: (id) => invoke(CH.playerLikeGet, id),
    setLiked: (id, liked) => invoke(CH.playerLikeSet, id, liked),
    queue: () => invoke(CH.playerQueue),
    recent: () => invoke(CH.playerRecent),
    openInSpotify: (track) => invoke(CH.playerOpen, track)
  },
  lyrics: {
    get: (track) => invoke(CH.lyricsGet, track),
    refresh: (track) => invoke(CH.lyricsRefresh, track),
    candidates: (track) => invoke(CH.lyricsCandidates, track),
    choose: (track, provider, id) => invoke(CH.lyricsChoose, track, provider, id),
    clearPin: (track) => invoke(CH.lyricsClearPin, track)
  },
  art: { get: (url) => invoke(CH.artGet, url) },
  moments: {
    list: () => invoke(CH.momentsList),
    add: (m) => invoke(CH.momentsAdd, m),
    remove: (id) => invoke(CH.momentsRemove, id)
  },
  app: {
    info: () => invoke(CH.appInfo),
    diagnostics: () => invoke(CH.appDiagnostics),
    failedShortcuts: () => invoke(CH.appShortcutStatus),
    onCommand: (cb) => subscribe(EV.command, cb)
  }
}

contextBridge.exposeInMainWorld('lyra', api)
