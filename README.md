# Lyra — glassmorphism lyrics & playback companion for Spotify

Floating widget → expanded mini player → cinematic fullscreen lyrics. Spotify stays the player; Lyra is the interface.

## Stack (why)
**Electron + React + TypeScript + Vite (electron-vite)**, Zustand, Framer Motion.
Needs on Windows: transparent frameless always-on-top window, global shortcuts, tray, screen-capture exclusion, multi-monitor. Electron does all of these maturely; Tauri's transparent-window and global-shortcut story on Windows is thinner. Renderer has no Node access (sandbox, contextIsolation, strict CSP); all network (Spotify, lyrics, artwork) happens in the main process.

## Run
```bash
npm install
node node_modules/electron/install.js   # only if you get "Electron uninstall"
npm run dev        # development
npm test           # LRC parser tests
npm run typecheck
npm run build && npm start   # production build preview
npm run dist       # Windows NSIS installer in ./release
```
**No credentials needed to try it:** click the widget → *Try demo mode*.

## Spotify setup (real playback)
1. https://developer.spotify.com/dashboard → *Create app* (Web API).
2. Redirect URI, exactly: `http://127.0.0.1:53682/callback`
3. Copy the **Client ID** (no secret — Authorization Code + PKCE).
4. Paste it in the app's connect screen, or put `SPOTIFY_CLIENT_ID=...` in `.env` (see `.env.example`).
5. While your app is in Development Mode, add your account under *User Management*.

Tokens are encrypted with Windows DPAPI (`safeStorage`) in the app's userData folder; the password is never seen.

## Spotify limits (honest list)
- No push events: playback is **polled** (3 s playing / 6 s paused / 5–15 s idle or hidden, honours `Retry-After`) and position is interpolated locally.
- Remote control (play/pause/seek/volume/next) requires **Premium**. Free accounts: display + lyrics work, controls are disabled with an explanation.
- Needs an *active device*; if Spotify is closed you get the "Nothing playing" state.
- Some devices don't accept volume changes (control disabled).
- Spotify offers no lyrics API. Lyrics come from **LRCLIB** (free, keyless, timestamped LRC; sends a descriptive User-Agent, no scraping). It's line-synced; **word-level** timing is supported by the engine (enhanced LRC) but LRCLIB rarely provides it — the demo shows it. Providers are pluggable: implement `LyricsProvider` in `src/main/lyrics/provider.ts`, add to the chain in `service.ts`.
- Spotify changed Development-Mode API access in 2025–26; if an endpoint (e.g. Like via `/me/tracks`, queue) returns an error, the UI degrades (button disabled / "not available") rather than failing. Verify against current docs.
- Windows can't blur the desktop behind a transparent window, so "glass" = translucent panel + blurred artwork layer, not true acrylic.

## Layout
```
src/shared     types, IPC contract, LRC parser (+tests), shortcut list
src/main       window.ts (modes, tween, drag, monitors) · tray · shortcuts · settings/jsonStore
               spotify/{auth,api,source,tokenStore} · lyrics/{provider,lrclib,service} · demo/ · artwork · ipc
src/preload    typed contextBridge API
src/renderer   store/ (player, lyrics, settings, ui) · hooks/ · components/ · styles/
```

## Keys
Global: Ctrl+Alt+Space play/pause · Ctrl+Alt+←/→ prev/next · Ctrl+Alt+L expand · Ctrl+Alt+F fullscreen · Ctrl+Alt+H show/hide.
In-app: Space, ←/→ seek, Shift+←/→ tracks, ↑/↓ volume, F, Esc, D (distraction-free), [ ] lyric offset.

## Status vs. phases
1–5 implemented (UI, desktop behaviour, Spotify PKCE + controls, LRCLIB lyrics + sync, themes/settings/saved moments/shortcuts). Phase 6 todo: real Spotify end-to-end run, installer icon (.ico), code-sign, a11y audit, bundle splitting.
Roadmap: configurable shortcuts, history dashboard, audio-reactive visualiser, translation, moments export, more providers.
