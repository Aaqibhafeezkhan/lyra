import { BrowserWindow, app, screen, shell, type Rectangle } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { EV } from '@shared/ipc'
import type { ModeEvent, Rect, Settings, ViewMode } from '@shared/types'
import { createLogger } from './logger'
import { settings } from './settings'
import { appIcon } from './tray'

const log = createLogger('window')

const MARGIN = 24
const SNAP_MARGIN = 12 // resting gap when snapped to a screen edge
const SNAP_DISTANCE = 16
const SETTLE_FALLBACK_MS = 800
const UNLOAD_AFTER_MS = 60_000 // hidden in the tray this long -> free the page

function sizeFor(mode: Exclude<ViewMode, 'full'>, s: Settings): { width: number; height: number } {
  switch (mode) {
    case 'minimal':
      return { width: Math.round(s.compactWidth * 0.78), height: 64 }
    case 'compact':
      return { width: s.compactWidth, height: 140 }
    case 'mini': {
      // tall player, but never taller than the screen's usable area
      const maxH = screen.getPrimaryDisplay().workArea.height - MARGIN * 2
      if (s.miniSize) return { width: s.miniSize.width, height: Math.min(s.miniSize.height, maxH) }
      return { width: Math.max(s.compactWidth + 40, 420), height: Math.min(700, maxH) }
    }
  }
}

const clampN = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

const union = (a: Rectangle, b: Rectangle): Rectangle => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
const rel = (r: Rectangle, origin: Rectangle): Rect => ({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height })

class WindowManager extends EventEmitter {
  private win: BrowserWindow | null = null
  private mode: ViewMode = 'compact'
  /** Top-left of the widget in windowed modes; where we return to after fullscreen. */
  private anchor: { x: number; y: number } | null = null
  /** Final window bounds waiting for the renderer to finish its shell transition. */
  private pendingFinal: Rectangle | null = null
  private settleTimer: NodeJS.Timeout | null = null
  private drag: { cx: number; cy: number; bounds: Rectangle } | null = null
  private resize: { cx: number; cy: number; bounds: Rectangle } | null = null
  private persistTimer: NodeJS.Timeout | null = null
  private topTimer: NodeJS.Timeout | null = null
  private fadeTimer: NodeJS.Timeout | null = null
  private outsideSince: number | null = null
  private faded = false
  private quitting = false
  private loginState: boolean | null = null

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  getMode(): ViewMode {
    return this.mode
  }

  create(): BrowserWindow {
    const s = settings.get()
    this.mode = s.defaultMode
    const size = sizeFor(this.mode as Exclude<ViewMode, 'full'>, s)
    const pos = this.initialPosition(size)
    this.anchor = pos

    const win = new BrowserWindow({
      ...size,
      ...pos,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: true,
      fullscreenable: false, // we emulate fullscreen with display bounds (reliable with transparency)
      hasShadow: false,
      skipTaskbar: false, // always in the taskbar so a minimized widget can be restored
      title: 'Lyra',
      icon: appIcon(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: true
      }
    })
    this.win = win

    win.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver')
    win.setContentProtection(s.hideOnScreenShare)

    // Hard-lock navigation: the renderer is a single local page.
    win.webContents.setWindowOpenHandler(({ url }) => {
      // Only a short allow-list of https hosts may be opened in the user's browser.
      const allowed = /^https:\/\/(open\.spotify\.com|accounts\.spotify\.com|developer\.spotify\.com|lrclib\.net|musicbrainz\.org)(\/|$)|^https:\/\/github\.com\/DhruvHarani1(\/|$)/
      if (allowed.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e) => e.preventDefault())

    win.once('ready-to-show', () => {
      win.showInactive()
      this.broadcastMode()
    })
    win.on('moved', () => this.onMoved())
    win.on('hide', () => this.armUnload())
    win.on('show', () => clearTimeout(this.unloadTimer))
    // The X buttons in the UI quit explicitly; a system "close" (Alt+F4, taskbar) just hides to the tray.
    win.on('close', (e) => {
      if (this.quitting) return
      e.preventDefault()
      win.hide()
    })
    app.on('before-quit', () => {
      this.quitting = true
    })
    // Windows silently drops TOPMOST when other topmost windows take focus; re-assert it.
    win.on('blur', () => this.reassertTop())
    win.on('show', () => this.reassertTop())
    this.topTimer = setInterval(() => this.reassertTop(), 2500)
    this.fadeTimer = setInterval(() => this.tickFade(), 250)
    win.on('closed', () => {
      if (this.topTimer) clearInterval(this.topTimer)
      if (this.fadeTimer) clearInterval(this.fadeTimer)
      this.win = null
    })

    this.loadApp(win)

    return win
  }

  private loadApp(win: BrowserWindow): Promise<void> {
    return process.env['ELECTRON_RENDERER_URL'] ? win.loadURL(process.env['ELECTRON_RENDERER_URL']) : win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ---- memory: while the widget sits hidden in the tray, drop the page (video, blur layers, caches) and bring it back on demand ----

  private unloaded = false
  private unloadTimer: ReturnType<typeof setTimeout> | undefined
  private waking: Promise<void> | null = null

  private armUnload(): void {
    clearTimeout(this.unloadTimer)
    this.unloadTimer = setTimeout(() => {
      const w = this.window
      if (!w || w.isVisible() || this.quitting || this.unloaded) return
      this.unloaded = true
      void w.webContents.loadURL('about:blank')
    }, UNLOAD_AFTER_MS)
  }

  /** Make sure the page is loaded (resolves once the UI is up and listening). */
  private wake(): Promise<void> {
    const w = this.window
    if (!w || !this.unloaded) return Promise.resolve()
    this.waking ??= (async () => {
      try {
        await this.loadApp(w)
        await new Promise((r) => setTimeout(r, 450)) // let the UI mount and subscribe before anything is sent to it
        this.unloaded = false
        this.broadcastMode()
      } finally {
        this.waking = null
      }
    })()
    return this.waking
  }

  /** Send a command (global shortcut / tray) to the UI, waking it first if it was unloaded. */
  sendCommand(cmd: string): void {
    void this.wake().then(() => {
      this.window?.webContents.send(EV.command, cmd)
      if (!this.window?.isVisible()) this.armUnload()
    })
  }

  private initialPosition(size: { width: number; height: number }): { x: number; y: number } {
    const saved = settings.get().position
    if (saved) return this.clampToDisplay({ ...saved, ...size })
    const wa = screen.getPrimaryDisplay().workArea
    return { x: wa.x + wa.width - size.width - MARGIN, y: wa.y + wa.height - size.height - MARGIN }
  }

  /** Keep a rectangle fully on the display it mostly overlaps (handles unplugged monitors). */
  private clampToDisplay(r: Rectangle): { x: number; y: number } {
    const wa = screen.getDisplayMatching(r).workArea
    return {
      x: Math.min(Math.max(r.x, wa.x), Math.max(wa.x, wa.x + wa.width - r.width)),
      y: Math.min(Math.max(r.y, wa.y), Math.max(wa.y, wa.y + wa.height - r.height))
    }
  }

  /**
   * "Fade when idle": decided here from the OS cursor position (reliable even when the window is not
   * focused) and pushed to the renderer, which only applies the dimming.
   */
  private tickFade(): void {
    const w = this.window
    if (!w) return
    const enabled = settings.get().autoHide && (this.mode === 'compact' || this.mode === 'minimal') && w.isVisible() && !this.drag && !this.resize
    if (!enabled && !this.faded) {
      this.outsideSince = null
      return
    }
    let fade = false
    if (enabled) {
      const c = screen.getCursorScreenPoint()
      const b = w.getBounds()
      const inside = c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height
      if (inside) this.outsideSince = null
      else {
        this.outsideSince ??= Date.now()
        fade = Date.now() - this.outsideSince >= 1200
      }
    } else this.outsideSince = null
    if (fade !== this.faded) {
      this.faded = fade
      w.webContents.send(EV.fade, fade)
    }
  }

  /** Put the widget back in the default corner at its current mode's size (used by Reset). */
  resetPlacement(): void {
    const w = this.window
    if (!w || this.mode === 'full') return
    const size = sizeFor(this.mode, settings.get())
    const wa = screen.getPrimaryDisplay().workArea
    const pos = { x: wa.x + wa.width - size.width - MARGIN, y: wa.y + wa.height - size.height - MARGIN }
    this.anchor = pos
    w.setBounds({ ...pos, ...size })
  }

  /** Keep the widget above other windows (no focus steal). */
  private reassertTop(): void {
    const w = this.window
    if (!w || !w.isVisible() || w.isMinimized() || this.drag) return
    // Fullscreen is a normal window: Alt+Tab to another app must show that app.
    if (this.mode !== 'full' && settings.get().alwaysOnTop) {
      w.setAlwaysOnTop(true, 'screen-saver')
      w.moveTop()
    }
  }

  private onMoved(): void {
    if (this.mode === 'full' || this.pendingFinal) return
    const w = this.window
    if (!w) return
    const b = w.getBounds()
    this.anchor = { x: b.x, y: b.y }
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => settings.update({ position: this.anchor }), 400)
  }

  // ---- modes ----

  setMode(next: ViewMode): void {
    const w = this.window
    if (!w || next === this.mode) return
    const prev = this.mode
    const s = settings.get()
    this.mode = next

    if (prev !== 'full') {
      const b = w.getBounds()
      this.anchor = { x: b.x, y: b.y }
    }

    let target: Rectangle
    if (next === 'full') {
      // Work area (not full bounds): without topmost the taskbar would otherwise cover the bottom controls.
      target = screen.getDisplayMatching(w.getBounds()).workArea
      w.setSkipTaskbar(false)
      w.setAlwaysOnTop(false)
    } else {
      const size = sizeFor(next, s)
      const a = this.anchor ?? this.initialPosition(size)
      // Collapsing from the taller mini player keeps the bottom edge stable for bottom-anchored widgets.
      const from = w.getBounds()
      const anchoredBottom = prev === 'mini' && next !== 'mini'
      const y = anchoredBottom ? from.y + from.height - size.height : a.y
      const x = prev === 'full' ? a.x : from.x
      const pos = this.clampToDisplay({ x, y: prev === 'full' ? a.y : y, ...size })
      target = { ...pos, ...size }
      w.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver')
      if (prev === 'full') w.focus()
    }

    this.transitionTo(next, target)
    if (next === 'mini' || next === 'full') w.focus()
  }

  /**
   * Shell-driven transition: grow the window ONCE to cover both the old and new rectangles and let the
   * renderer animate its own shell between them (GPU-composited, no per-frame OS resize). The window is
   * shrunk to its final size in `settle()` once the animation finishes.
   */
  private transitionTo(mode: ViewMode, target: Rectangle): void {
    const w = this.window
    if (!w) return
    const from = w.getBounds()
    if (this.settleTimer) clearTimeout(this.settleTimer)

    if (settings.get().reducedMotion === 'on') {
      this.pendingFinal = null
      w.setBounds(target)
      this.sendMode({ mode })
      return
    }
    const big = union(from, target)
    this.pendingFinal = target
    if (big.x !== from.x || big.y !== from.y || big.width !== from.width || big.height !== from.height) w.setBounds(big)
    this.sendMode({ mode, from: rel(from, big), to: rel(target, big) })
    this.settleTimer = setTimeout(() => this.settle(), SETTLE_FALLBACK_MS)
  }

  /** Called by the renderer when its shell animation has finished. */
  settle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    const w = this.window
    const final = this.pendingFinal
    this.pendingFinal = null
    if (w && final) w.setBounds(final)
  }

  toggleExpand(): void {
    if (this.mode === 'full') this.setMode('mini')
    else if (this.mode === 'mini') this.setMode(settings.get().defaultMode)
    else this.setMode('mini')
  }

  toggleFullscreen(): void {
    this.setMode(this.mode === 'full' ? 'mini' : 'full')
  }

  private broadcastMode(): void {
    this.sendMode({ mode: this.mode })
  }

  private sendMode(e: ModeEvent): void {
    this.window?.webContents.send(EV.mode, e)
    this.emit('mode', e.mode)
  }

  // ---- dragging (cursor-driven; immune to DPI rounding drift) ----

  dragStart(): void {
    const w = this.window
    if (!w || this.mode === 'full') return
    const c = screen.getCursorScreenPoint()
    this.drag = { cx: c.x, cy: c.y, bounds: w.getBounds() }
  }

  dragMove(): void {
    const w = this.window
    if (!w || !this.drag) return
    const c = screen.getCursorScreenPoint()
    const { bounds } = this.drag
    const moved = { x: bounds.x + (c.x - this.drag.cx), y: bounds.y + (c.y - this.drag.cy), width: bounds.width, height: bounds.height }
    w.setBounds({ ...moved, ...this.snap(moved) })
  }

  /** Magnetic edges: snap to the work area border (with a small margin) when close. */
  private snap(r: Rectangle): { x: number; y: number } {
    const wa = screen.getDisplayMatching(r).workArea
    const left = wa.x + SNAP_MARGIN
    const right = wa.x + wa.width - SNAP_MARGIN - r.width
    const top = wa.y + SNAP_MARGIN
    const bottom = wa.y + wa.height - SNAP_MARGIN - r.height
    const near = (v: number, target: number): boolean => Math.abs(v - target) <= SNAP_DISTANCE
    return {
      x: near(r.x, left) ? left : near(r.x, right) ? right : r.x,
      y: near(r.y, top) ? top : near(r.y, bottom) ? bottom : r.y
    }
  }

  dragEnd(): void {
    this.drag = null
    this.onMoved()
  }

  // ---- resizing (custom grip: the window itself is not user-resizable because it is transparent) ----

  resizeStart(): void {
    const w = this.window
    if (!w || this.mode === 'full' || this.pendingFinal) return
    const c = screen.getCursorScreenPoint()
    this.resize = { cx: c.x, cy: c.y, bounds: w.getBounds() }
  }

  resizeMove(): void {
    const w = this.window
    const r = this.resize
    if (!w || !r || this.mode === 'full') return
    const c = screen.getCursorScreenPoint()
    const wa = screen.getDisplayMatching(r.bounds).workArea
    const maxW = Math.max(300, wa.x + wa.width - r.bounds.x)
    const maxH = Math.max(300, wa.y + wa.height - r.bounds.y)
    let width = r.bounds.width + (c.x - r.cx)
    let height = r.bounds.height + (c.y - r.cy)
    if (this.mode === 'mini') {
      width = clampN(width, 360, Math.min(700, maxW))
      height = clampN(height, 480, Math.min(1200, maxH))
    } else {
      // widgets are fixed-height; only the width is adjustable
      const k = this.mode === 'minimal' ? 0.78 : 1
      width = clampN(width, Math.ceil(320 * k), Math.min(Math.floor(520 * k), maxW))
      height = r.bounds.height
    }
    w.setBounds({ x: r.bounds.x, y: r.bounds.y, width, height })
  }

  resizeEnd(): void {
    const w = this.window
    this.resize = null
    if (!w || this.mode === 'full') return
    const b = w.getBounds()
    if (this.mode === 'mini') settings.update({ miniSize: { width: b.width, height: b.height } })
    else settings.update({ compactWidth: Math.round(b.width / (this.mode === 'minimal' ? 0.78 : 1)) })
  }

  // ---- visibility / settings ----

  toggleVisible(): void {
    const w = this.window
    if (!w) return
    if (w.isVisible() && !w.isMinimized()) w.hide()
    else this.show()
  }

  show(): void {
    const w = this.window
    if (!w) return
    void this.wake().then(() => {
      if (w.isDestroyed()) return
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    })
  }

  hide(): void {
    this.window?.hide()
  }

  minimize(): void {
    this.window?.minimize()
  }

  /**
   * "Launch at startup". Electron writes the HKCU Run entry itself; some security software silently blocks
   * an unsigned app from doing that, so if it didn't stick we write/remove it with reg.exe (Microsoft-signed).
   */
  private syncLoginItem(enable: boolean): void {
    if (!app.isPackaged) return
    // Only act on a change (and at startup when enabled, which also repairs a path that moved after an update).
    if (this.loginState === enable || (this.loginState === null && !enable)) {
      this.loginState = enable
      return
    }
    this.loginState = enable
    try {
      app.setLoginItemSettings({ openAtLogin: enable, name: 'Lyra', path: process.execPath })
    } catch (e) {
      log.warn('setLoginItemSettings failed', (e as Error).message)
    }
    const key = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
    const args = enable ? ['add', key, '/v', 'Lyra', '/t', 'REG_SZ', '/d', `"${process.execPath}"`, '/f'] : ['delete', key, '/v', 'Lyra', '/f']
    execFile('reg.exe', args, { windowsHide: true }, (err) => {
      if (err && enable) log.warn('could not register launch-at-startup', err.message)
    })
  }

  applySettings(s: Settings): void {
    const w = this.window
    if (!w) return
    if (this.mode !== 'full') w.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver')
    w.setContentProtection(s.hideOnScreenShare)
    this.syncLoginItem(s.launchAtStartup)
    // Resize resting layouts when width changes
    if (!this.resize && !this.pendingFinal && (this.mode === 'minimal' || this.mode === 'compact' || this.mode === 'mini')) {
      const size = sizeFor(this.mode as Exclude<ViewMode, 'full'>, s)
      const b = w.getBounds()
      if (b.width !== size.width || b.height !== size.height) {
        log.debug('resize for settings', size)
        w.setBounds({ ...this.clampToDisplay({ x: b.x, y: b.y, ...size }), ...size })
      }
    }
  }
}

export const windows = new WindowManager()
