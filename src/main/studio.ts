import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { open, rm, type FileHandle } from 'node:fs/promises'
import { CH, EV } from '@shared/ipc'
import { windows } from './window'

/**
 * Lyric-video export (main side): picks the output file, appends the encoded MP4 as it is produced (a long video
 * is never held in memory) and lets the app window capture the PC's sound only while an export is running.
 */
const files = new Map<number, FileHandle>()
let nextId = 1
let capturing = false

export const studio = {
  /** The window may capture the PC's sound right now. */
  get capturing(): boolean {
    return capturing
  }
}

/**
 * YouTube as a background: the video plays in a hidden, off-screen window (muted) and every painted frame is
 * sent to the app window as a JPEG, where the export draws it behind the lyrics. The window never shows up and
 * keeps working while Lyra is in the background.
 */
let stage: BrowserWindow | null = null

// everything the player draws on top of the picture: controls, captions, titles, end cards
const HIDE_PLAYER_UI = '.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,.ytp-large-play-button,.ytp-spinner,.ytp-watermark,.ytp-ce-element,.ytp-cards-teaser,.ytp-caption-window-container,.caption-window,.ytp-player-content,.ytp-iv-video-content,.ytp-endscreen-content,.ytp-youtube-button,.ytp-paid-content-overlay,.ytp-popup,.ytp-contextmenu{display:none!important} #player-controls,#player-control-overlay,.ytPlayerControlsContainerHost,player-middle-controls,.player-controls-background,.new-controls,[class*=player-controls]{display:none!important} video{cursor:none!important} .html5-video-player > :not(.html5-video-container){display:none!important}'

function stopStage(): void {
  if (stage && !stage.isDestroyed()) stage.destroy()
  stage = null
}

async function startStage(o: { videoId: string; width: number; height: number; fps: number; startSec: number }): Promise<{ ok: boolean; reason?: string }> {
  stopStage()
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(o.videoId))) return { ok: false, reason: 'Bad video id' }
  const width = Math.max(320, Math.min(1920, Math.round(o.width)))
  const height = Math.max(180, Math.min(1080, Math.round(o.height)))
  const fps = Math.max(2, Math.min(30, Math.round(o.fps)))
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: { offscreen: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  stage = win
  win.webContents.setAudioMuted(true)
  win.webContents.setFrameRate(fps)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('paint', (_e, _dirty, image) => {
    const target = windows.window
    if (!target || target.isDestroyed()) return
    target.webContents.send(EV.studioFrame, image.toJPEG(88))
  })
  const start = Math.max(0, Math.floor(o.startSec))
  const url =
    `https://www.youtube-nocookie.com/embed/${o.videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${o.videoId}&start=${start}` +
    '&modestbranding=1&playsinline=1&disablekb=1&rel=0&fs=0&iv_load_policy=3&cc_load_policy=0&vq=' + (height >= 1000 ? 'hd1080' : 'hd720')
  win.webContents.on('dom-ready', () => void win.webContents.insertCSS(HIDE_PLAYER_UI).catch(() => undefined))
  try {
    await win.loadURL(url)
    await win.webContents.insertCSS(HIDE_PLAYER_UI)
    // wait until a picture is actually playing (or the player says it can not)
    for (let i = 0; i < 60; i++) {
      if (win.isDestroyed()) return { ok: false, reason: 'cancelled' }
      const state = (await win.webContents.executeJavaScript(
        "(() => { const v = document.querySelector('video'); const err = document.querySelector('.ytp-error-content-wrap-reason, .ytp-error'); return err ? 'error:' + (err.textContent || '').trim().slice(0, 120) : v && v.readyState >= 3 && !v.paused ? 'ok' : v && v.paused && v.readyState >= 3 ? 'paused' : 'wait' })()"
      )) as string
      if (state === 'ok') return { ok: true }
      if (state === 'paused') await win.webContents.executeJavaScript("document.querySelector('video')?.play()")
      if (state.startsWith('error:')) return { ok: false, reason: state.slice(6) || 'This video can not be played here.' }
      await new Promise((r) => setTimeout(r, 500))
    }
    return { ok: false, reason: 'The video did not start in time.' }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export function registerStudioIpc(): void {
  ipcMain.handle(CH.studioStageStart, (_e, o) => startStage(o))
  ipcMain.handle(CH.studioStageSeek, async (_e, sec: number) => {
    if (stage && !stage.isDestroyed() && Number.isFinite(sec)) await stage.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); if (v) { v.currentTime = ${Math.max(0, sec)}; v.play() } })()`)
  })
  ipcMain.handle(CH.studioStageSync, async (_e, sec: number) => {
    if (!stage || stage.isDestroyed() || !Number.isFinite(sec)) return
    await stage.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); if (v && Math.abs(v.currentTime - ${sec}) > 0.7) v.currentTime = ${Math.max(0, sec)} })()`)
  })
  ipcMain.handle(CH.studioStageStop, () => stopStage())
  ipcMain.handle(CH.studioOpen, async (_e, suggested: string) => {
    const name = String(suggested || 'lyra-video.mp4').replace(/[\\/:*?"<>|]/g, '-')
    const win = windows.window
    const opts = { title: 'Save lyric video', defaultPath: name, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] }
    // development only: skip the dialog so the export can be tested without clicking
    const test = !app.isPackaged ? process.env['LYRA_TEST_SAVE'] : undefined
    const r = test ? { canceled: false, filePath: test } : win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const fh = await open(r.filePath, 'w')
    const id = nextId++
    files.set(id, fh)
    capturing = true
    return { id, path: r.filePath }
  })
  ipcMain.handle(CH.studioWrite, async (_e, id: number, position: number, chunk: Uint8Array) => {
    const fh = files.get(id)
    if (!fh || !Number.isFinite(position) || position < 0) return
    await fh.write(chunk, 0, chunk.byteLength, position)
  })
  ipcMain.handle(CH.studioClose, async (_e, id: number) => {
    const fh = files.get(id)
    files.delete(id)
    await fh?.close()
  })
  ipcMain.handle(CH.studioDiscard, async (_e, path: string) => {
    if (typeof path === 'string' && path.toLowerCase().endsWith('.mp4')) await rm(path, { force: true })
  })
  ipcMain.handle(CH.studioEnd, () => {
    capturing = false
  })
  ipcMain.handle(CH.studioReveal, (_e, path: string) => {
    if (typeof path === 'string' && path.toLowerCase().endsWith('.mp4')) shell.showItemInFolder(path)
  })
}
