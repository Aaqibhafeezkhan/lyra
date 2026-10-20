# Where to list Lyra

Ordered by effort vs. audience. "You" = needs the maintainer's account; "Ready" = files are in this repo.

## Windows
| Place | Audience | Status |
|---|---|---|
| **winget** (`winget install DhruvHarani1.Lyra`) | Everyone on Windows 10/11, built in | Manifest ready in `packaging/winget`. Submit: `winget install wingetcreate`, then `wingetcreate submit packaging/winget/manifests/d/DhruvHarani1/Lyra/0.5.0` (needs a GitHub token with `public_repo`, you sign the CLA once). |
| **Scoop** | Developers, power users | `packaging/scoop/lyra.json` ready. Create a repo `scoop-bucket`, put the file in `bucket/`, share `scoop bucket add lyra https://github.com/DhruvHarani1/scoop-bucket`. |
| **Chocolatey** | IT / power users | Community moderation takes days; do after winget. |
| **Microsoft Store** | Casual users who only trust the Store | Individual developer accounts are free (start at storedeveloper.microsoft.com, ID check). Needs an MSIX/store package and certification. Worth it once the app is stable. |
| **SignPath Foundation** | Removes the SmartScreen warning | Free code signing for open-source projects: signpath.org/foundation. |

## Android
| Place | Audience | Status |
|---|---|---|
| **IzzyOnDroid** | Open-source Android fans, no Play Protect warning | Reads GitHub releases and `fastlane/`. Request inclusion with an issue in the IzzyOnDroid repo-data project (see their inclusion policy). Draft text in `docs/launch/izzyondroid-request.md`. |
| **F-Droid** | Biggest open-source Android audience | Recipe + steps in `docs/FDROID.md` (needs a GitLab account). Slower: review takes weeks. |
| **Google Play** | Largest reach | One-time $25. Needs a Notification-access declaration and a privacy policy URL. Later. |
| **GitHub Releases** | Direct APK | Done. |

## Directories and communities
- **AlternativeTo** (list as an alternative to Musixmatch, Lyrically, Spotify's lyrics view), **Product Hunt**, **Show HN**.
- **Reddit:** r/spotify, r/opensource, r/FOSS, r/androidapps, r/windows, r/developersIndia (read each sub's self-promo rules first).
- **Lists:** awesome-spotify, awesome-electron, awesome-android-open-source, itsfoss / OMG! Ubuntu style blogs, alternativeto.
- Short vertical video (Reels / Shorts / TikTok): the reel in `brag-output/` and clips in `website/assets`.

## Do not
- Do not buy followers or stars, post the same text everywhere on one day, or ask for upvotes. It backfires.
