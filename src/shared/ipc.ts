import type {
  AppCommand,
  CommandResult,
  ConnectionStatus,
  LyricsCandidateInfo,
  LyricsResult,
  ModeEvent,
  PlaybackSnapshot,
  PlayerCommand,
  QueueItem,
  RecentItem,
  SavedMoment,
  Settings,
  Track,
  UpdateState,
  BackgroundResolution,
  YoutubeVideo,
  ViewMode
} from './types'

/** Invoke channels (renderer -> main). */
export const CH = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',
  windowSetMode: 'window:set-mode',
  windowGetMode: 'window:get-mode',
  windowDragStart: 'window:drag-start',
  windowDragMove: 'window:drag-move',
  windowDragEnd: 'window:drag-end',
  windowResizeStart: 'window:resize-start',
  windowResizeMove: 'window:resize-move',
  windowResizeEnd: 'window:resize-end',
  windowSettle: 'window:settle',
  windowHide: 'window:hide',
  windowMinimize: 'window:minimize',
  windowQuit: 'window:quit',
  spotifyConnect: 'spotify:connect',
  spotifyDisconnect: 'spotify:disconnect',
  spotifyStatus: 'spotify:status-get',
  spotifySnapshot: 'spotify:snapshot-get',
  spotifyDemo: 'spotify:demo',
  spotifyLocal: 'spotify:local',
  playerCommand: 'player:command',
  playerLikeGet: 'player:like-get',
  playerLikeSet: 'player:like-set',
  playerQueue: 'player:queue',
  playerRecent: 'player:recent',
  playerOpen: 'player:open',
  lyricsGet: 'lyrics:get',
  lyricsRefresh: 'lyrics:refresh',
  lyricsCandidates: 'lyrics:candidates',
  lyricsChoose: 'lyrics:choose',
  lyricsClearPin: 'lyrics:clear-pin',
  artGet: 'art:get',
  momentsList: 'moments:list',
  momentsAdd: 'moments:add',
  momentsRemove: 'moments:remove',
  appInfo: 'app:info',
  appDiagnostics: 'app:diagnostics',
  appCopy: 'app:copy',
  appShortcutStatus: 'app:shortcut-status',
  bgResolve: 'bg:resolve',
  bgPick: 'bg:pick',
  bgClear: 'bg:clear',
  bgKeyHas: 'bg:key-has',
  bgKeySet: 'bg:key-set',
  bgKeyClear: 'bg:key-clear',
  bgYtCandidates: 'bg:yt-candidates',
  bgYtChoose: 'bg:yt-choose',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateInstall: 'update:install'
} as const

/** Push channels (main -> renderer). */
export const EV = {
  settings: 'ev:settings',
  status: 'ev:status',
  playback: 'ev:playback',
  mode: 'ev:mode',
  command: 'ev:command',
  update: 'ev:update',
  fade: 'ev:fade'
} as const

export interface AppInfo {
  version: string
  platform: string
  envClientId: boolean
}

export type Unsubscribe = () => void

/** Surface exposed on `window.lyra` by the preload script. */
export interface LyraApi {
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    /** Restore every setting (and widget size/position) to its default. */
    reset(): Promise<Settings>
    onChange(cb: (s: Settings) => void): Unsubscribe
  }
  window: {
    setMode(mode: ViewMode): Promise<void>
    getMode(): Promise<ViewMode>
    onMode(cb: (e: ModeEvent) => void): Unsubscribe
    /** Cursor-driven dimming of the small widget ("Fade when idle"). */
    onFade(cb: (faded: boolean) => void): Unsubscribe
    /** Finish a shell-driven transition: shrink the window to its final size. */
    settle(): void
    resizeStart(): void
    resizeMove(): void
    resizeEnd(): void
    dragStart(): void
    dragMove(): void
    dragEnd(): void
    hide(): void
    /** Minimize to the taskbar (click its icon to restore). */
    minimize(): void
    quit(): void
  }
  spotify: {
    connect(clientId?: string): Promise<ConnectionStatus>
    disconnect(): Promise<void>
    startDemo(): Promise<void>
    useLocal(): Promise<void>
    getStatus(): Promise<ConnectionStatus>
    getSnapshot(): Promise<PlaybackSnapshot | null>
    onStatus(cb: (s: ConnectionStatus) => void): Unsubscribe
    onPlayback(cb: (s: PlaybackSnapshot) => void): Unsubscribe
  }
  player: {
    command(cmd: PlayerCommand): Promise<CommandResult>
    isLiked(trackId: string): Promise<boolean | null>
    setLiked(trackId: string, liked: boolean): Promise<CommandResult>
    queue(): Promise<QueueItem[] | null>
    recent(): Promise<RecentItem[] | null>
    /** null just launches the Spotify app. */
    openInSpotify(track: Track | null): Promise<void>
  }
  lyrics: {
    get(track: Track): Promise<LyricsResult>
    /** Bypass cache (e.g. after a network error). */
    refresh(track: Track): Promise<LyricsResult>
    /** Ranked alternatives for fixing a wrong match. */
    candidates(track: Track): Promise<{ items: LyricsCandidateInfo[]; error?: string }>
    choose(track: Track, provider: string, id: string): Promise<LyricsResult>
    clearPin(track: Track): Promise<LyricsResult>
  }
  art: {
    /** Returns a data: URL (cached) so the renderer never needs remote image access. */
    get(url: string): Promise<string | null>
  }
  moments: {
    list(): Promise<SavedMoment[]>
    add(m: Omit<SavedMoment, 'id' | 'savedAt'>): Promise<SavedMoment[]>
    remove(id: string): Promise<SavedMoment[]>
  }
  background: {
    /** Decide what to show behind the lyrics for this track. */
    resolve(track: Track): Promise<BackgroundResolution>
    /** Open a file picker; scope 'song' attaches to that track, 'global' is the default for all songs. */
    pick(scope: 'song' | 'global', trackId?: string): Promise<{ ok: boolean; error?: string }>
    clear(scope: 'song' | 'global', trackId?: string): Promise<void>
    hasYoutubeKey(): Promise<boolean>
    setYoutubeKey(key: string): Promise<{ ok: boolean; error?: string }>
    clearYoutubeKey(): Promise<void>
    youtubeCandidates(track: Track): Promise<{ items: YoutubeVideo[]; error?: string }>
    /** Pin a specific video for this song (remembered). null = back to automatic. */
    youtubeChoose(trackId: string, videoId: string | null): Promise<void>
  }
  update: {
    get(): Promise<UpdateState>
    check(): Promise<void>
    /** Restart and install a downloaded update. */
    install(): Promise<void>
    onState(cb: (s: UpdateState) => void): Unsubscribe
  }
  /** Only present in the Android app. */
  android?: {
    hasAccess(): Promise<boolean>
    openAccessSettings(): Promise<void>
    openBatterySettings(): Promise<void>
    overlayState(): Promise<{ enabled: boolean; canDraw: boolean }>
    /** the live-lyrics notification (shade + lock screen) */
    lyricsNotification(): Promise<{ enabled: boolean; public: boolean }>
    setLyricsNotification(on: boolean, showOnLockScreen: boolean): Promise<void>
    /** open the dim always-on-display style lyrics screen */
    openAmbient(): Promise<void>
    /** ambient screen on/off, like the tile / widget / shortcut */
    toggleAmbient(): Promise<void>
    /** ask Android to add the "Lyra ambient" tile to Quick Settings (Android 13+) */
    addAmbientTile(): Promise<boolean>
    /** needsPermission: Android opened the "Display over other apps" screen; the user must allow it, then try again */
    setOverlay(on: boolean): Promise<{ ok: boolean; needsPermission?: boolean }>
  }
  app: {
    info(): Promise<AppInfo>
    /** Plain-text report (versions, settings, recent log) safe to paste into a bug report. */
    diagnostics(): Promise<string>
    /** Copy plain text to the system clipboard. */
    copy(text: string): Promise<boolean>
    /** Ids of global shortcuts another app already owns. */
    failedShortcuts(): Promise<string[]>
    onCommand(cb: (c: AppCommand) => void): Unsubscribe
  }
}
