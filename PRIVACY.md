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
| Spotify image CDN | the artwork URL Spotify already gave Lyra | download cover art (only when using the optional Spotify API source) |

Lyra reads what the Spotify desktop app is playing through Windows media controls. It never sees your
Spotify password or account. If you enable the optional Spotify API source, tokens are encrypted with
Windows DPAPI and stored locally.

Requests go straight from your PC to those services; Lyra has no server of its own.
