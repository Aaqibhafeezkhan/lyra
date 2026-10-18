# Privacy

Lyra runs entirely on your PC. There are no accounts, no analytics and no telemetry.

**What stays local:** your settings, favorites, saved lyric moments, per-song lyric choices and offsets,
and caches (lyrics, artwork, release years). They live in `%APPDATA%\Lyra`. Uninstalling Lyra does not
delete that folder; remove it by hand if you want everything gone.

**What leaves your PC (only while a song plays):**
| Service | Sent | Why |
|---|---|---|
| [LRCLIB](https://lrclib.net) | song title, artist, album, duration | find synchronized lyrics |
| [MusicBrainz](https://musicbrainz.org) | song title, artist, duration | look up the release year |
| [Apple iTunes Search](https://performance-partners.apple.com/search-api) | song title, artist | find a free 30-second music-video preview for the cinematic background (on by default; turn off by choosing "Living" or "Still" as the background style) |
| Google YouTube Data API + [youtube-nocookie.com](https://www.youtube-nocookie.com) | song title, artist; then the video player loads from YouTube | **only if you paste your own YouTube API key** in Settings → Background: find and play the official music video, muted, behind the lyrics |
| Spotify image CDN | the artwork URL Spotify already gave Lyra | download cover art (only when using the optional Spotify API source) |

Lyra reads what the Spotify desktop app is playing through Windows media controls. It never sees your
Spotify password or account. If you enable the optional Spotify API source, tokens are encrypted with
Windows DPAPI and stored locally.

Backgrounds you choose (GIF, image, MP4, WebM) are **copied** into `%APPDATA%\Lyra\backgrounds` and never uploaded.
A YouTube API key, if you add one, is encrypted with Windows DPAPI, kept only in the main process and never shown
to the interface; remove it any time in Settings → Background.

Requests go straight from your PC to those services; Lyra has no server of its own.
