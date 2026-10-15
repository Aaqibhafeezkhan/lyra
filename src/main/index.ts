import { app, session } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger'
import { disposePlayback, registerIpc, setBackground, startPlayback } from './ipc'
import { favorites } from './favorites'
import { moments } from './moments'
import { settings } from './settings'
import { applyShortcuts, disposeShortcuts } from './shortcuts'
import { createTray } from './tray'
import { windows } from './window'

const log = createLogger('main')

/** Minimal .env loader for development (packaged builds use settings.json instead). */
function loadDotEnv(): void {
  for (const dir of [process.cwd(), app.getAppPath()]) {
    const file = join(dir, '.env')
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && !line.trimStart().startsWith('#') && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
    }
    return
  }
}

function installCsp(): void {
  const dev = !app.isPackaged
  const csp = dev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  // The renderer never needs device permissions.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => windows.show())

  app.whenReady().then(() => {
    app.setAppUserModelId('dev.lyra.companion')
    loadDotEnv()
    installCsp()
    registerIpc()
    const win = windows.create()
    createTray()
    applyShortcuts(settings.get().globalShortcuts)
    windows.applySettings(settings.get())
    startPlayback()

    // Slow polling while the widget isn't visible.
    win.on('hide', () => setBackground(true))
    win.on('minimize', () => setBackground(true))
    win.on('show', () => setBackground(false))
    win.on('restore', () => setBackground(false))

    let shortcutsOn = settings.get().globalShortcuts
    settings.on('change', (s) => {
      if (s.globalShortcuts !== shortcutsOn) {
        shortcutsOn = s.globalShortcuts
        applyShortcuts(shortcutsOn)
      }
    })
    log.info(`started v${app.getVersion()}`)
  })

  // Widget lives in the tray; closing the window never quits.
  app.on('window-all-closed', () => {
    /* keep running */
  })
  app.on('before-quit', () => {
    disposeShortcuts()
    disposePlayback()
    settings.flush()
    moments.flush()
    favorites.flush()
  })
}
