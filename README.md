# Lyra — glassmorphism lyrics & playback companion for Spotify

Floating widget → expanded mini player → cinematic fullscreen lyrics. Spotify stays the player; Lyra is the interface.
**Free and account-free:** it reads the Spotify desktop app through Windows media controls and fetches lyrics from LRCLIB. No API key, no Premium, no login.

## Run (Windows 10/11)
Requirements: Node 20+, the **Spotify desktop app** (not the web player).

```bash
npm install
node node_modules/electron/install.js   # only if you get "Electron uninstall"
npm run dev        # development
npm test           # LRC parser tests
npm run typecheck
npm run build && npm start   # production build preview
npm run dist       # Windows NSIS installer in ./release
npm run dist:local # same, but works around antivirus EPERM rename failures
```
Play a song in Spotify — the widget shows it. Click the widget to expand; fullscreen button (or `F`) for immersive lyrics. No Spotify handy? *Settings → Music source → Demo*.

## Music sources
| Source | Needs | Gives | Missing |
|---|---|---|---|
| **Windows (default)** | Spotify desktop app | title, artist, album, artwork, position, play/pause/next/previous/seek, **system volume**, release year (MusicBrainz), Lyra-local favorites ♥ | queue, shuffle/repeat (buttons hidden), syncing likes to Spotify |
| Spotify API (optional) | your own Spotify Developer app (Client ID) | everything above + volume, queue, likes, devices | **Premium** for any control; Dev Mode needs a Premium app owner and your account under *User Management* |
| Demo | nothing | simulated playback with sample lyrics | — |

How the default works: a tiny native helper (`resources/lyra-media.exe`, ~14 KB, C#) subscribes to the Windows System Media Transport Controls events and streams JSON to the app (`src/main/smtc`, `native/lyra-media`). It is event-driven (≈0% CPU idle) and only follows a session whose app id contains "Spotify". Rebuild it with `npm run build:helper` (needs the Windows SDK; the built exe is committed). If the exe is missing the app falls back to a PowerShell bridge. Volume (opt-in: *Settings → System → Control system volume*) is the Windows master volume via Core Audio. Release year is looked up once per song on MusicBrainz and cached. Favorites are stored locally in `favorites.json`.

### Optional: Spotify API setup (on hold — implemented but not yet tested against a real account)
1. https://developer.spotify.com/dashboard → *Create app* (Web API).
2. Redirect URI, exactly: `http://127.0.0.1:53682/callback`
3. Copy the **Client ID** (PKCE — no secret). Paste it in *Settings → Music source → Spotify API*, or set `SPOTIFY_CLIENT_ID` in `.env` (see `.env.example`).
4. Add your account under *User Management*.

Tokens are encrypted with Windows DPAPI (`safeStorage`); passwords are never seen. The API source polls (3 s playing / 6 s paused / 5–15 s idle, honours `Retry-After`).

## Lyrics
**LRCLIB** (free, keyless, timestamped LRC; descriptive User-Agent; no scraping). Line-synced; word-level timing is supported by the engine (enhanced LRC) but LRCLIB rarely has it — the demo shows it. Results are cached on disk. Plain-only lyrics are shown unsynced, with a notice. Use the `−`/`+` footer (or `[` `]`) to nudge sync. Providers are pluggable: implement `LyricsProvider` in `src/main/lyrics/provider.ts`, add it to the chain in `service.ts`.

## Notes & limits
- Windows can't blur the desktop behind a transparent window, so "glass" = translucent panel + blurred artwork layer, not true acrylic.
- Always-on-top uses the highest topmost level and is re-asserted on blur and every 2.5 s.
- Spotify changed Development-Mode API rules in 2025–26; API features degrade (disabled buttons, explanations) instead of failing.

## Layout
```
src/shared     types, IPC contract, LRC parser (+tests), shortcut list
src/main       window (modes, tween, drag, monitors) · tray · shortcuts · settings
               smtc/ (Windows media bridge) · spotify/ (PKCE API) · lyrics/ · demo/ · artwork · ipc
src/preload    typed contextBridge API
src/renderer   store/ · hooks/ · components/ · styles/
```

## Keys
Global: Ctrl+Alt+Space play/pause · Ctrl+Alt+←/→ prev/next · Ctrl+Alt+L expand · Ctrl+Alt+F fullscreen · Ctrl+Alt+H show/hide.
In-app: Space, ←/→ seek, Shift+←/→ tracks, ↑/↓ volume (API source), F, Esc, D (distraction-free), `[` `]` lyric offset.

## Roadmap
Free replacements for the account-free gaps (see issues), configurable shortcuts, installer icon + autostart polish, history dashboard, audio-reactive visualiser, lyric translation, moments export.

## Legal & privacy
MIT licensed ([LICENSE](LICENSE)). See [PRIVACY.md](PRIVACY.md) for exactly what leaves your PC and [THIRD_PARTY.md](THIRD_PARTY.md) for credits. Lyra is not affiliated with Spotify; Spotify is a trademark of Spotify AB.
