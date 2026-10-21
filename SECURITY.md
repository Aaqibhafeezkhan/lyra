# Security policy

Lyra reads what you play and shows lyrics. It never needs your passwords, and it has no accounts or analytics.

## Reporting a vulnerability
Please **do not open a public issue** for a security problem. Use GitHub's private reporting:
**Security → Report a vulnerability** on https://github.com/DhruvHarani1/lyra/security/advisories/new

Include what you found, how to reproduce it, and the version. I will reply within a few days, fix it, and credit you if you like.

## Supported versions
Only the latest release of the Windows app (`v*`) and the Android app (`android-v*`) gets fixes. The Windows app updates itself.

## What is in scope
- The Windows and Android apps, the local TV-mode server, the room/Jam features, the website in `website/`.
- Supply chain: dependencies, GitHub Actions workflows, release signing.

## How the project protects itself
- Releases are built by GitHub Actions from tags; the Android APK is signed with a key stored only in repository secrets.
- Secret scanning with push protection, Dependabot alerts and updates, and CodeQL are enabled.
- Fork pull requests need maintainer approval before any workflow runs.
- The Windows app runs with a sandboxed renderer, context isolation and a strict content security policy. The TV-mode server is off by default, read-only and needs a secret link.
