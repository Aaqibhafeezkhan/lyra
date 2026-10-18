import { app, session } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger'
import { disposePlayback, registerIpc, setBackground, startPlayback } from './ipc'
import { favorites } from './favorites'
import { moments } from './moments'
import { settings } from './settings'
import { applyShortcuts, disposeShortcuts } from './shortcuts'
import { BG_SCHEME, background, registerBackgroundScheme } from './background/service'
import { createTray } from './tray'
import { updater } from './updater'
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

registerBackgroundScheme()

function installCsp(): void {
  const dev = !app.isPackaged
  const media = `${BG_SCHEME}:`
  const embed = 'https://www.youtube-nocookie.com'
  const csp = dev
    ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${media}; media-src 'self' ${media} https://*.itunes.apple.com; frame-src ${embed}; font-src 'self' data:; connect-src 'self' ws: http://localhost:*`
    : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${media}; media-src 'self' ${media} https://*.itunes.apple.com; frame-src ${embed}; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    // Only OUR pages get our policy. Third-party documents (the YouTube player) keep their own headers,
    // otherwise our "default-src 'self'" would block their scripts.
    const ours = details.url.startsWith('file://') || details.url.startsWith('http://localhost') || details.url.startsWith(`${media}//`)
    cb(ours ? { responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } } : {})
  })
  // YouTube's embedded player refuses to run without a Referer; our pages are file:// so supply an https one.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] }, (details, cb) => {
    cb({ requestHeaders: { ...details.requestHeaders, Referer: 'https://github.com/DhruvHarani1/lyra' } })
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
    background.registerProtocol()
    background.collectGarbage()
    registerIpc()
    const win = windows.create()
    createTray()
    applyShortcuts(settings.get().globalShortcuts, settings.get().shortcuts)
    windows.applySettings(settings.get())
    startPlayback()
    updater.start()

    // Slow polling while the widget isn't visible.
    win.on('hide', () => setBackground(true))
    win.on('minimize', () => setBackground(true))
    win.on('show', () => setBackground(false))
    win.on('restore', () => setBackground(false))

    let shortcutKey = JSON.stringify([settings.get().globalShortcuts, settings.get().shortcuts])
    settings.on('change', (s) => {
      const key = JSON.stringify([s.globalShortcuts, s.shortcuts])
      if (key !== shortcutKey) {
        shortcutKey = key
        applyShortcuts(s.globalShortcuts, s.shortcuts)
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
    updater.dispose()
  })
}
