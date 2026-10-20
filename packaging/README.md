# Packaging

Ready-to-submit manifests for package managers. Update the version and SHA-256 for each release
(`gh api repos/DhruvHarani1/lyra/releases/tags/vX.Y.Z -q '.assets[] | [.name,.digest] | @tsv'`).

- `winget/` – submit with `wingetcreate submit` (or a PR to microsoft/winget-pkgs). After the first one is accepted,
  `wingetcreate update DhruvHarani1.Lyra --version X.Y.Z --urls <installer url> --submit` handles new versions.
- `scoop/lyra.json` – put it in a Scoop bucket (your own `scoop-bucket` repo works with `scoop bucket add`).
