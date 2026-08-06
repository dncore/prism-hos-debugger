# Scripts

| Script | Purpose |
|---|---|
| `setup.sh` | Install all dependencies (Python, Node, Electron) and build Web UI |
| `dev.sh` | Start prism server + open browser (CLI mode) |
| `dev-electron.sh` | Start Electron desktop app with tray icon |
| `build-release.sh` | Build production .dmg (PyInstaller + Electron) |

## GitHub Release

Push a version tag to trigger automatic build + release:

```bash
git tag v0.3.0
git push origin v0.3.0
```

GitHub Actions will build the macOS .dmg and attach it to the release automatically.
