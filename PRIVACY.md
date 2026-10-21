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

**On Android** the same rules apply, plus: Lyra asks for *Notification access* only so Android will let it see which song is playing (title, artist, album, position, cover). It does not read or store your notifications. Your settings, saved lines, and any background video/GIF you pick live in the app's private storage; a YouTube API key is encrypted with the Android Keystore. The optional floating widget and "keep running" service only show lyrics and keep the app alive; they send nothing anywhere.

Requests go straight from your PC to those services; Lyra has no server of its own.

## Optional network features (off by default)

- **TV & party mode** serves a read-only lyrics page on your local network. It needs a secret link, sends nothing to the internet and exposes only what is playing.
- **Listen together** (rooms) connects friends' browsers directly to your Lyra with WebRTC. The public PeerJS broker (0.peerjs.com) only introduces the two sides, and a public STUN server helps them find each other, so both can see the other's network address. Only the song title, artist, position and synced lyrics are shared, never audio or files. Stop the room and nothing more is shared.
- **Jam nearby** (stream sound to the TV-mode page) is a second, separate switch. While someone is listening, Lyra sends everything this PC plays to that device over your local network (a direct WebRTC link, no internet, no recording). Turn it off in Settings → Share.
- **Export lyric video** records the song as it plays. On Windows a small helper (`lyra-audio.exe`) listens to the Spotify app's own sound only, so other programs and notifications stay out; if that is not possible, the whole PC sound is recorded instead. Nothing is uploaded: the video is saved to the file you choose.
