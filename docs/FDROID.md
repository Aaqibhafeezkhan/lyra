# Publishing Lyra on F-Droid

F-Droid is free and run by volunteers. It builds apps from source, signs them with its own key and serves them through the F-Droid app. Installs from an app store like F-Droid are not blocked by Google Play Protect's "enhanced fraud protection" (which blocks browser-downloaded APKs that ask for notification access / overlay permissions in some countries, including India).

## What is already in this repo
- `fastlane/metadata/android/en-US/` – title, descriptions, changelogs (`<versionCode>.txt`), icon and screenshots. F-Droid shows these.
- `fdroid/dev.lyra.android.yml` – draft build recipe for F-Droid's `fdroiddata` repository.
- `android/app/version.properties` – the one place with `versionName` / `versionCode`.
- MIT licence, no Google Play Services, no closed-source libraries.

## What you have to do (needs your own GitLab account)
1. Create a free account at https://gitlab.com.
2. Easiest: open a **"Request for Packaging"** issue at https://gitlab.com/fdroid/rfp/-/issues/new with the repo URL (`https://github.com/DhruvHarani1/lyra`), the app id `dev.lyra.android`, the licence (MIT), a one-line description, and "Android app is in the `android/` folder; the web UI is built with `npm ci && npm run build:android-ui`".
3. Or send the packaging yourself: fork https://gitlab.com/fdroid/fdroiddata, copy `fdroid/dev.lyra.android.yml` to `metadata/dev.lyra.android.yml`, and open a merge request. Read their [Contributing guide](https://gitlab.com/fdroid/fdroiddata/-/blob/master/CONTRIBUTING.md) first; reviewers usually ask for small recipe changes.
4. Reviews take days to weeks. After merge, F-Droid builds new versions by itself whenever you push a tag like `android-v0.1.2` (`UpdateCheckMode: Tags`).

## Things reviewers may raise
- **Anti-feature `NonFreeNet`** is declared: Lyra fetches lyrics from lrclib.net, preview clips from Apple, and (only with the user's own key) videos from YouTube.
- **Node build:** the recipe builds the web UI with `npm ci`. If their build server's Node is too old for Vite, the recipe needs a newer Node via `srclibs`/`sudo`.
- **Different signing key:** the F-Droid build is signed by F-Droid, so it will not update over the APK from GitHub Releases (and vice versa). Pick one source on your phone.

## Releasing a new version
1. Bump both numbers in `android/app/version.properties` (`versionCode` must always go up), and add `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`.
2. Commit, then push a tag `android-v<versionName>`. The **Android** workflow checks the tag matches the file, builds and signs the APK, and attaches it to a GitHub release.
