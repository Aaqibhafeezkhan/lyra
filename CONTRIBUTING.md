# Contributing to Lyra

Thanks for helping! Lyra is a small, friendly project. Every kind of help counts: bug reports, translations, ideas, code.

## Quick start
```bash
npm install
npm run dev          # Windows app with hot reload
npm run typecheck && npm test
```
Android: see the Android section of the [README](README.md) (`npm run build:android-ui`, then Gradle).

## Where things live
- `src/core` – platform-neutral logic (lyrics, backgrounds). Shared by Windows and Android.
- `src/main` – Electron main process (Windows): media controls, windows, updater, TV mode.
- `src/renderer` – the React UI, shared by both apps. `src/android-web` adapts it for the phone.
- `android/` – the Kotlin shell for Android.
- `website/` – the static site (deployed on Vercel).

## Good first issues
Look for the **good first issue** label. Typical ones: a new lyric source (see `LyricsProvider`), UI text and translations, accessibility fixes, small bugs.

## Guidelines
- Keep changes focused and small; match the surrounding style.
- No analytics, accounts or trackers: privacy is a feature.
- Test what you change (the app, or `npm test` for the parsers) and say how in the PR.
- Be kind. See the code of conduct below.

## Code of conduct
Be respectful and welcoming. Harassment, discrimination or personal attacks are not tolerated. Report problems by opening an issue or contacting the maintainer.
