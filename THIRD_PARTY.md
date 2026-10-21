# Third-party services & software

- **LRCLIB** (https://lrclib.net) — community lyrics database used for synchronized lyrics. Lyrics belong
  to their respective rights holders; Lyra only displays them for personal use and caches them locally.
- **PublicDomainOnly** ([project](https://github.com/kennethyork/PubDomainOnly), [data licence](https://github.com/kennethyork/PubDomainOnly/blob/main/LICENSE.md)) — optional last-resort catalogue loaded from its public `lyrics_data.json`. The provider uses only the collection described by its maintainer as public-domain works in the United States; coverage is limited, and public-domain status can vary by country. The provider is not a source for contemporary copyrighted lyrics.
- **MusicBrainz** (https://musicbrainz.org) — release-year lookups. MusicBrainz core data is CC0.
- **Apple iTunes Search API** — public, keyless; used to find 30-second music-video previews that Apple
  publishes for promotion. Clips are streamed for display only and never saved or redistributed.
- **YouTube** (YouTube Data API v3 and the embedded player) — optional, only with a key supplied by the user.
  Use is governed by the [YouTube API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service).
  The player is the official embed, unmodified, muted and visibly dimmed; Lyra does not download or rip video.
- **Electron, React, Framer Motion, Zustand, Vite** — MIT licensed.
- **Inter** typeface (@fontsource-variable/inter) — SIL Open Font License 1.1.
- **Spotify** is a trademark of Spotify AB. Lyra is an independent project and is not affiliated with,
  endorsed by or sponsored by Spotify.
