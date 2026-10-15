import { BrowserWindow, app, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { EV } from '@shared/ipc'
import type { Settings, ViewMode } from '@shared/types'
import { createLogger } from './logger'
import { settings } from './settings'

const log = createLogger('window')

const MARGIN = 24
const ANIM_MS = 280

function sizeFor(mode: Exclude<ViewMode, 'full'>, s: Settings): { width: number; height: number } {
  switch (mode) {
    case 'minimal':
      return { width: Math.round(s.compactWidth * 0.78), height: 64 }
    case 'compact':
      return { width: s.compactWidth, height: 140 }
    case 'mini':
      // tall player, but never taller than the screen's usable area
      return {
        width: Math.max(s.compactWidth + 40, 420),
        height: Math.min(700, screen.getPrimaryDisplay().workArea.height - MARGIN * 2)
      }
  }
}

const ease = (t: number): number => 1 - Math.pow(1 - t, 3)

class WindowManager extends EventEmitter {
  private win: BrowserWindow | null = null
  private mode: ViewMode = 'compact'
  /** Top-left of the widget in windowed modes; where we return to after fullscreen. */
  private anchor: { x: number; y: number } | null = null
  private anim: NodeJS.Timeout | null = null
  private drag: { cx: number; cy: number; bounds: Rectangle } | null = null
  private persistTimer: NodeJS.Timeout | null = null
  private topTimer: NodeJS.Timeout | null = null

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
      skipTaskbar: this.mode !== 'mini',
      title: 'Lyra',
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
      if (/^https:\/\/(open\.spotify\.com|accounts\.spotify\.com|developer\.spotify\.com)\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e) => e.preventDefault())

    win.once('ready-to-show', () => {
      win.showInactive()
      this.broadcastMode()
    })
    win.on('moved', () => this.onMoved())
    // Windows silently drops TOPMOST when other topmost windows take focus; re-assert it.
    win.on('blur', () => this.reassertTop())
    win.on('show', () => this.reassertTop())
    this.topTimer = setInterval(() => this.reassertTop(), 2500)
    win.on('closed', () => {
      if (this.topTimer) clearInterval(this.topTimer)
      this.win = null
    })

    if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    else void win.loadFile(join(__dirname, '../renderer/index.html'))

    return win
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
    if (this.mode === 'full' || this.anim) return
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
      w.setSkipTaskbar(next !== 'mini')
      w.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver')
      if (prev === 'full') w.focus()
    }

    this.broadcastMode()
    this.animateTo(target, next === 'full' || prev === 'full')
    if (next === 'mini' || next === 'full') w.focus()
  }

  private animateTo(target: Rectangle, fast: boolean): void {
    const w = this.window
    if (!w) return
    if (this.anim) clearInterval(this.anim)
    const reduced = settings.get().reducedMotion === 'on'
    const from = w.getBounds()
    if (reduced) {
      w.setBounds(target)
      this.anim = null
      return
    }
    const dur = fast ? ANIM_MS + 60 : ANIM_MS
    const t0 = Date.now()
    this.anim = setInterval(() => {
      const win = this.window
      if (!win) {
        if (this.anim) clearInterval(this.anim)
        this.anim = null
        return
      }
      const p = Math.min(1, (Date.now() - t0) / dur)
      const e = ease(p)
      win.setBounds({
        x: Math.round(from.x + (target.x - from.x) * e),
        y: Math.round(from.y + (target.y - from.y) * e),
        width: Math.round(from.width + (target.width - from.width) * e),
        height: Math.round(from.height + (target.height - from.height) * e)
      })
      if (p >= 1) {
        if (this.anim) clearInterval(this.anim)
        this.anim = null
      }
    }, 16)
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
    this.window?.webContents.send(EV.mode, this.mode)
    this.emit('mode', this.mode)
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
    w.setBounds({ x: bounds.x + (c.x - this.drag.cx), y: bounds.y + (c.y - this.drag.cy), width: bounds.width, height: bounds.height })
  }

  dragEnd(): void {
    this.drag = null
    this.onMoved()
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
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  hide(): void {
    this.window?.hide()
  }

  applySettings(s: Settings): void {
    const w = this.window
    if (!w) return
    if (this.mode !== 'full') w.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver')
    w.setContentProtection(s.hideOnScreenShare)
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.launchAtStartup })
    // Resize resting layouts when width changes
    if (this.mode === 'minimal' || this.mode === 'compact' || this.mode === 'mini') {
      const size = sizeFor(this.mode, s)
      const b = w.getBounds()
      if (b.width !== size.width || b.height !== size.height) {
        log.debug('resize for settings', size)
        w.setBounds({ ...this.clampToDisplay({ x: b.x, y: b.y, ...size }), ...size })
      }
    }
  }
}

export const windows = new WindowManager()
