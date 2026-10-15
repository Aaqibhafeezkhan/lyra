import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { EventEmitter } from 'node:events'
import { accessSync, constants, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UpdateState } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('updater')

const FIRST_CHECK_MS = 25_000
const EVERY_MS = 6 * 3600_000

/**
 * Self-updates from GitHub releases. electron-updater downloads only the changed blocks (blockmap),
 * keeps the downloaded installer in its cache and verifies it, so nothing is downloaded twice;
 * the update installs when the app quits (or immediately via `install()`).
 */
class Updater extends EventEmitter {
  private current: UpdateState = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private started = false

  get state(): UpdateState {
    return this.current
  }

  private set(s: UpdateState): void {
    this.current = s
    this.emit('state', s)
  }

  start(): void {
    if (this.started) return
    this.started = true
    if (!app.isPackaged) {
      this.set({ state: 'disabled', reason: 'Updates are only available in the installed app.' })
      return
    }
    this.useInstallFolderForDownloads()
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = {
      info: (m: unknown) => log.info(String(m)),
      warn: (m: unknown) => log.warn(String(m)),
      error: (m: unknown) => log.error(String(m)),
      debug: () => undefined
    }

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'none' }))
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', version: i.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => {
      const v = this.current.state === 'downloading' ? this.current.version : ''
      this.set({ state: 'downloading', version: v, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', version: i.version }))
    autoUpdater.on('error', (e) => {
      log.warn('update error', e?.message ?? e)
      this.set({ state: 'error', message: friendly(e?.message ?? String(e)) })
    })

    setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), EVERY_MS)
  }

  /**
   * Keep downloaded updates next to the app (the folder the user chose in the installer) instead of
   * %LOCALAPPDATA% on the system drive. Falls back to electron-updater's default if it isn't writable.
   */
  private useInstallFolderForDownloads(): void {
    try {
      const dir = join(dirname(process.execPath), 'updates')
      mkdirSync(dir, { recursive: true })
      accessSync(dir, constants.W_OK)
      const adapter = (autoUpdater as unknown as { app: object }).app
      Object.defineProperty(adapter, 'baseCachePath', { get: () => dir, configurable: true })
      log.info('update downloads go to', dir)
      // remove the old default cache once, so an earlier download doesn't linger on the system drive
      const legacy = join(process.env['LOCALAPPDATA'] ?? '', 'lyra-updater')
      if (process.env['LOCALAPPDATA']) rmSync(legacy, { recursive: true, force: true })
    } catch (e) {
      log.warn('could not use the install folder for updates; using the default cache', (e as Error).message)
    }
  }

  async check(): Promise<void> {
    if (!app.isPackaged) return
    // don't interrupt a finished or in-flight download
    if (this.current.state === 'downloading' || this.current.state === 'ready' || this.current.state === 'checking') return
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ state: 'error', message: friendly((e as Error).message) })
    }
  }

  install(): void {
    if (this.current.state === 'ready') autoUpdater.quitAndInstall(false, true)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }
}

function friendly(msg: string): string {
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::|network/i.test(msg)) return 'Couldn’t reach GitHub. Check your connection.'
  if (/404|Not Found|latest\.yml/i.test(msg)) return 'No update information was found yet.'
  if (/rate limit|403/i.test(msg)) return 'GitHub is rate limiting update checks. Try again later.'
  return msg.slice(0, 160)
}

export const updater = new Updater()
