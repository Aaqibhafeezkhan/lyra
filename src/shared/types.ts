// Types shared by main, preload and renderer. No runtime imports allowed here.

export type ViewMode = 'minimal' | 'compact' | 'mini' | 'full'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Sent when the window mode changes. When `from`/`to` are present the window has already been grown to
 * cover both rectangles and the renderer must animate its shell between them (coordinates are relative
 * to the window), then call `window.settle()`.
 */
export interface ModeEvent {
  mode: ViewMode
  from?: Rect
  to?: Rect
}

export interface Track {
  /** Stable id: Spotify track id, or `demo:<n>` in demo mode. */
  id: string
  uri: string
  title: string
  artists: string[]
  album: string
  releaseYear: number | null
  durationMs: number
  artworkUrl: string | null
  explicit: boolean
  /** https URL that opens the track in Spotify (null for demo). */
  webUrl: string | null
}

export interface PlaybackDevice {
  id: string | null
  name: string
  type: string
  volumePercent: number | null
  supportsVolume: boolean
}

export interface PlaybackSnapshot {
  track: Track | null
  isPlaying: boolean
  /** Position at `sampledAt`. Renderer interpolates while playing. */
  positionMs: number
  /** Date.now() on the main process when position was sampled (corrected for request latency). */
  sampledAt: number
  device: PlaybackDevice | null
  shuffle: boolean
  repeat: 'off' | 'track' | 'context'
  /** True when Spotify reports an ad / non-music item. */
  isAdOrUnknown: boolean
}

export type ConnectionState =
  | 'needs-setup' // no client id configured
  | 'disconnected' // client id set, not signed in
  | 'connecting' // browser auth in flight
  | 'connected'
  | 'offline' // signed in but network/API unreachable
  | 'demo'
  | 'local' // Windows media controls (no account needed)

export interface ConnectionStatus {
  state: ConnectionState
  message?: string
  /** Seconds until the next retry when rate-limited. */
  retryInSec?: number
  userName?: string
  product?: string // 'premium' | 'free' | 'open'
  /** Account can't use remote playback control (non-premium). */
  controlsLimited?: boolean
}

export interface QueueItem {
  id: string
  title: string
  artists: string[]
  artworkUrl: string | null
}

export interface RecentItem extends QueueItem {
  playedAt: string
}

export type PlayerCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; percent: number }
  | { type: 'shuffle'; on: boolean }
  | { type: 'repeat'; mode: 'off' | 'track' | 'context' }

export interface CommandResult {
  ok: boolean
  /** Human-readable reason when !ok. */
  error?: string
  /** Machine hint so UI can show the right explanation. */
  reason?: 'premium-required' | 'no-device' | 'rate-limited' | 'offline' | 'unauthorized' | 'unsupported' | 'unknown'
}

// ---------- Lyrics ----------

export interface LyricWord {
  timeMs: number
  text: string
}

export interface LyricLine {
  timeMs: number
  text: string
  /** Only present when the source supplied word-level timing. */
  words?: LyricWord[]
  /** When the last word ends (set for estimated timing so it does not stretch across a long gap). */
  endMs?: number
}

export type LyricsStatus = 'synced' | 'plain' | 'instrumental' | 'none' | 'error'

export interface LyricsCandidateInfo {
  provider: string
  id: string
  title: string
  artist: string
  album: string
  durationMs: number
  synced: boolean
  instrumental: boolean
}

export interface LyricsResult {
  trackId: string
  status: LyricsStatus
  provider: string
  lines: LyricLine[]
  plain?: string
  wordSynced?: boolean
  /** True when the user manually picked this match. */
  pinned?: boolean
  /** What the provider matched, so the UI can reveal wrong matches. */
  matched?: { title: string; artist: string; durationMs: number }
  error?: { kind: 'network' | 'rate-limit' | 'server' | 'unknown'; message: string; retryable: boolean }
}

// ---------- Settings ----------

export type ThemeMode = 'dark' | 'light' | 'adaptive'
export type LyricFont = 'sans' | 'serif' | 'rounded' | 'mono'
export type LyricAnimation = 'glide' | 'focus' | 'fade'
/** how fullscreen lyrics are laid out over a video */
export type FullLayout = 'cinema' | 'split' | 'poster'

export type SourceKind = 'local' | 'api'

export type BackgroundStyle = 'auto' | 'living' | 'custom' | 'youtube' | 'still'

/** A user-supplied image / GIF / video that Lyra copied into its own folder. */
export interface BackgroundMedia {
  /** file name inside userData/backgrounds (never a user path) */
  file: string
  /** original name, for display */
  name: string
  kind: 'video' | 'image'
}

export interface YoutubeVideo {
  videoId: string
  title: string
  channel: string
  durationSec: number | null
}

/** fractions (0-0.3) of black bars to trim from each edge of a video */
export interface VideoCrop {
  t: number
  r: number
  b: number
  l: number
}
export type BackgroundSpec =
  | { kind: 'living' }
  | { kind: 'still' }
  | { kind: 'media'; url: string; media: 'video' | 'image'; name: string; scope: 'song' | 'global' }
  | { kind: 'youtube'; videoId: string; title: string; channel: string; durationSec: number | null; crop: VideoCrop | null; scope: 'song' | 'auto' }
  /** free 30s music-video preview from Apple's public iTunes Search API (no key needed) */
  | { kind: 'preview'; url: string; title: string; width: number }

export interface BackgroundResolution {
  spec: BackgroundSpec
  /** why YouTube isn't (or is) being used, for the panel */
  youtube: 'off' | 'no-key' | 'found' | 'none' | 'error' | 'pinned'
  youtubeMessage?: string
  /** the free Apple clip, kept ready in case the YouTube video can not be played in the app */
  fallback?: BackgroundSpec
  /** other plausible videos of the same song, tried in turn when the first one can not be played here */
  alternates?: BackgroundSpec[]
  hasSongMedia: boolean
  hasGlobalMedia: boolean
}

export interface Settings {
  /** How the animated background behind the lyrics is chosen. */
  backgroundStyle: BackgroundStyle
  /** 0.2–0.9: how much the background is darkened for readability. */
  backgroundDim: number
  /** Also use the video/GIF background in the expanded player (fullscreen always does). */
  backgroundInMini: boolean
  /** adapt the dim to how bright the video is */
  autoDim: boolean
  /** Used for every song that has no media of its own. */
  customBackground: BackgroundMedia | null
  /** Where playback info comes from: Windows media controls (default, no account) or Spotify Web API. */
  source: SourceKind
  defaultMode: Exclude<ViewMode, 'full'>
  opacity: number // 0.4 - 1
  alwaysOnTop: boolean
  autoHide: boolean
  hideOnScreenShare: boolean
  launchAtStartup: boolean
  globalShortcuts: boolean
  /** User overrides for global shortcuts: id -> Electron accelerator. */
  shortcuts: Record<string, string>
  /** First-run welcome has been dismissed. */
  onboarded: boolean
  /** Windows source only: control the system volume (loads a helper some antivirus tools flag). */
  systemVolume: boolean
  trackNotifications: boolean
  /** TV & party mode: serve a read-only lyrics page to other devices on the same network. */
  lanViewer: boolean
  /** Also stream this PC's sound to the TV-mode page (Jam nearby). */
  lanAudio: boolean
  lanPort: number
  /** Secret in the viewer link (generated on first use). */
  lanToken: string
  theme: ThemeMode
  lyricFont: LyricFont
  lyricFontSize: number // px, fullscreen base
  lineSpacing: number // 1 - 2
  lyricAnimation: LyricAnimation
  fullLayout: FullLayout
  /** Show a Roman-letter transliteration below Hindi and Punjabi lyrics. */
  romanizeLyrics: boolean
  /** highlight each word as it is sung (estimated unless the source has real word timing) */
  wordByWord: boolean
  /** Android: keep the screen on while a song plays */
  keepScreenOn: boolean
  /** Android: run a small foreground service so the system does not close Lyra */
  keepRunning: boolean
  /** Android ambient screen: black, a dim colour glow, or a dim video */
  ambientStyle: 'minimal' | 'glow' | 'video'
  /** Android ambient screen brightness (0.02 darkest .. 0.6) */
  ambientBrightness: number
  /** Android: let the ambient screen follow the room light (the slider is then the maximum) */
  ambientAutoBrightness: boolean
  lyricOffsetMs: number
  reducedMotion: 'system' | 'on' | 'off'
  compactWidth: number
  /** User-resized size of the expanded player (null = automatic). */
  miniSize: { width: number; height: number } | null
  position: { x: number; y: number } | null
  spotifyClientId: string
}

export const DEFAULT_SETTINGS: Settings = {
  backgroundStyle: 'auto',
  backgroundDim: 0.5,
  backgroundInMini: false,
  autoDim: true,
  customBackground: null,
  source: 'local',
  defaultMode: 'compact',
  opacity: 0.94,
  alwaysOnTop: true,
  autoHide: false,
  hideOnScreenShare: false,
  launchAtStartup: false,
  globalShortcuts: true,
  shortcuts: {},
  onboarded: false,
  systemVolume: false,
  trackNotifications: false,
  lanViewer: false,
  lanAudio: false,
  lanPort: 47813,
  lanToken: '',
  theme: 'adaptive',
  lyricFont: 'sans',
  lyricFontSize: 40,
  lineSpacing: 1.35,
  lyricAnimation: 'glide',
  fullLayout: 'cinema',
  wordByWord: true,
  romanizeLyrics: false,
  keepScreenOn: false,
  keepRunning: false,
  ambientStyle: 'video', // the music video, dimmed (switch to Glow or Minimal in Settings)
  ambientBrightness: 0.2,
  ambientAutoBrightness: true,
  lyricOffsetMs: 0,
  reducedMotion: 'system',
  compactWidth: 380,
  miniSize: null,
  position: null,
  spotifyClientId: ''
}

export interface SavedMoment {
  id: string
  trackId: string
  title: string
  artist: string
  artworkUrl: string | null
  text: string
  timeMs: number
  savedAt: number
}

export type AppCommand =
  | 'toggle-play'
  | 'next'
  | 'previous'
  | 'toggle-expand'
  | 'toggle-fullscreen'
  | 'open-settings'

export type UpdateState =
  | { state: 'disabled'; reason: string }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' } // up to date
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
