import { BrowserWindow, app, dialog, ipcMain, powerSaveBlocker, shell } from 'electron'
import { open, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CH, EV } from '@shared/ipc'
import { windows } from './window'

/**
 * Lyric-video export (main side): picks the output file, appends the encoded MP4 as it is produced (a long video
 * is never held in memory) and lets the app window capture the PC's sound only while an export is running.
 */
const files = new Map<number, FileHandle>()
let nextId = 1
let capturing = false
let blocker: number | null = null
let micOpen = false

/**
 * An export is running: keep the app window rendering at full speed even when it is covered or minimized (Chromium
 * would otherwise slow it right down, which shows up as freezes in the video) and keep Windows awake.
 */
function setExporting(on: boolean): void {
  capturing = on
  const w = windows.window
  if (w && !w.isDestroyed()) w.webContents.setBackgroundThrottling(!on)
  if (on && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!on && blocker !== null) {
    powerSaveBlocker.stop(blocker)
    blocker = null
  }
}

export const studio = {
  /** The window may capture the PC's sound right now. */
  get capturing(): boolean {
    return capturing
  },
  /** the karaoke screen is open: the app window may use the microphone */
  get mic(): boolean {
    return micOpen
  }
}

/**
 * YouTube as a background: the video plays in a hidden, off-screen window (muted) and every painted frame is
 * sent to the app window as a JPEG, where the export draws it behind the lyrics. The window never shows up and
 * keeps working while Lyra is in the background.
 */
let stage: BrowserWindow | null = null

/**
 * "Smooth" export: while the song plays, the YouTube pictures are appended to a temporary file (with their times)
 * instead of being sent to the window. The video is drawn from that file afterwards, at exact times.
 */
interface FrameSink {
  path: string
  fh: FileHandle
  t0: number
  times: number[]
  offsets: number[]
  lengths: number[]
  tail: number
  queue: Promise<void>
  reader: FileHandle | null
}
let sink: FrameSink | null = null

async function frameCaptureStart(): Promise<boolean> {
  await frameCaptureClear()
  try {
    const path = join(tmpdir(), `lyra-frames-${Date.now()}.bin`)
    const fh = await open(path, 'w')
    sink = { path, fh, t0: Date.now(), times: [], offsets: [], lengths: [], tail: 0, queue: Promise.resolve(), reader: null }
    return true
  } catch {
    return false
  }
}

async function frameCaptureStop(): Promise<number[] | null> {
  const s = sink
  if (!s) return null
  await s.queue.catch(() => undefined)
  await s.fh.close().catch(() => undefined)
  s.reader = await open(s.path, 'r').catch(() => null)
  s.t0 = -1 // no more pictures are appended
  return s.times.length ? s.times : null
}

async function frameCaptureClear(): Promise<void> {
  const s = sink
  sink = null
  if (!s) return
  await s.queue.catch(() => undefined)
  await s.fh.close().catch(() => undefined)
  await s.reader?.close().catch(() => undefined)
  await rm(s.path, { force: true })
}

// everything the player draws on top of the picture: controls, captions, titles, end cards
const HIDE_PLAYER_UI = '.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,.ytp-large-play-button,.ytp-spinner,.ytp-watermark,.ytp-ce-element,.ytp-cards-teaser,.ytp-caption-window-container,.caption-window,.ytp-player-content,.ytp-iv-video-content,.ytp-endscreen-content,.ytp-youtube-button,.ytp-paid-content-overlay,.ytp-popup,.ytp-contextmenu{display:none!important} #player-controls,#player-control-overlay,.ytPlayerControlsContainerHost,player-middle-controls,.player-controls-background,.new-controls,[class*=player-controls]{display:none!important} video{cursor:none!important} .html5-video-player > :not(.html5-video-container){display:none!important}'

function stopStage(): void {
  if (stage && !stage.isDestroyed()) stage.destroy()
  stage = null
}

async function startStage(o: { videoId: string; width: number; height: number; fps: number; startSec: number }): Promise<{ ok: boolean; reason?: string; quality?: string; bestHeight?: number }> {
  stopStage()
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(o.videoId))) return { ok: false, reason: 'Bad video id' }
  // up to 1440p: the sharpest picture that the hidden window can hand over at 30 pictures a second without choking the PC
  const width = Math.max(320, Math.min(2560, Math.round(o.width)))
  const height = Math.max(180, Math.min(1440, Math.round(o.height)))
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
    const jpeg = image.toJPEG(height >= 1200 ? 84 : 88)
    const s = sink
    if (s) {
      if (s.t0 < 0) return
      const at = s.tail
      s.tail += jpeg.byteLength
      s.times.push(Date.now() - s.t0)
      s.offsets.push(at)
      s.lengths.push(jpeg.byteLength)
      s.queue = s.queue.then(() => s.fh.write(jpeg, 0, jpeg.byteLength, at).then(() => undefined))
      return
    }
    target.webContents.send(EV.studioFrame, jpeg)
  })
  const start = Math.max(0, Math.floor(o.startSec))
  const url =
    `https://www.youtube-nocookie.com/embed/${o.videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${o.videoId}&start=${start}` +
    '&modestbranding=1&playsinline=1&disablekb=1&rel=0&fs=0&iv_load_policy=3&cc_load_policy=0&vq=' + (height >= 1300 ? 'hd1440' : height >= 1000 ? 'hd1080' : 'hd720')
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
      if (state === 'ok') {
        const q = await settleQuality(win, height)
        return { ok: true, quality: q.res, bestHeight: q.best }
      }
      if (state === 'paused') await win.webContents.executeJavaScript("document.querySelector('video')?.play()")
      if (state.startsWith('error:')) return { ok: false, reason: state.slice(6) || 'This video can not be played here.' }
      await new Promise((r) => setTimeout(r, 500))
    }
    return { ok: false, reason: 'The video did not start in time.' }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * YouTube starts a video in low resolution and works its way up. Ask the player for the best stream that is not
 * bigger than the picture we will hand over, then wait (up to 12 s) until it really arrives, so the first seconds
 * of the export are not blurry. Returns what we got, e.g. "2560x1440".
 */
async function settleQuality(win: BrowserWindow, height: number): Promise<{ res: string; best: number }> {
  const order = [['hd2160', 2160], ['hd1440', 1440], ['hd1080', 1080], ['hd720', 720], ['large', 480], ['medium', 360]] as const
  let seen = ''
  let best = 0
  for (let i = 0; i < 24; i++) {
    if (win.isDestroyed()) return { res: seen.split('|')[0] ?? '', best }
    seen = (await win.webContents
      .executeJavaScript(
        `(() => { const p = document.getElementById('movie_player'); const v = document.querySelector('video');
          const cap = ${height}; const order = ${JSON.stringify(order)};
          const have = p && p.getAvailableQualityLevels ? p.getAvailableQualityLevels() : [];
          const pick = order.find(([l, h]) => h <= cap && have.includes(l)) || order.find(([l]) => have.includes(l)) || order[2];
          if (p && p.setPlaybackQualityRange) { p.setPlaybackQualityRange(pick[0], pick[0]); p.setPlaybackQuality && p.setPlaybackQuality(pick[0]); }
          const top = order.find(([l]) => have.includes(l));
          return (v ? v.videoWidth + 'x' + v.videoHeight : '') + '|' + pick[1] + '|' + (top ? top[1] : 0) })()`
      )
      .catch(() => '')) as string
    const [res, want, top] = seen.split('|')
    best = Number(top ?? 0)
    const vh = Number((res ?? '').split('x')[1] ?? 0)
    if (vh && vh >= Math.min(Number(want), best || Number(want)) * 0.95) return { res: res ?? '', best }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { res: seen.split('|')[0] ?? '', best }
}

/** Captures only the Spotify app's sound with resources/lyra-audio.exe and forwards the PCM to the app window. */
let audio: ChildProcessWithoutNullStreams | null = null

function stopAudio(): void {
  audio?.kill()
  audio = null
}

function spotifyRootPid(): Promise<number | null> {
  return new Promise((resolve) => {
    // Spotify runs many processes; the one without a --type flag is the parent, and capturing it includes its children
    const ps = "(Get-CimInstance Win32_Process -Filter \"Name='Spotify.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1).ProcessId"
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, out) => {
      const n = Number(String(out).trim())
      resolve(!err && Number.isFinite(n) && n > 0 ? n : null)
    })
  })
}

async function startAudio(): Promise<{ ok: boolean; reason?: string }> {
  stopAudio()
  const exe = [join(process.resourcesPath ?? '', 'lyra-audio.exe'), join(app.getAppPath(), 'resources', 'lyra-audio.exe')].find((p) => existsSync(p))
  if (!exe) return { ok: false, reason: 'helper missing' }
  const pid = await spotifyRootPid()
  if (!pid) return { ok: false, reason: 'Spotify is not running' }
  return new Promise((resolve) => {
    const p = spawn(exe, ['--pid', String(pid)], { windowsHide: true })
    audio = p
    let settled = false
    const done = (r: { ok: boolean; reason?: string }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let err = ''
    p.stderr.on('data', (d: Buffer) => {
      err += d.toString()
      if (/ready/.test(err)) done({ ok: true })
    })
    p.stdout.on('data', (d: Buffer) => {
      const w = windows.window
      if (w && !w.isDestroyed()) w.webContents.send(EV.studioAudio, d)
    })
    p.on('error', (e) => done({ ok: false, reason: e.message }))
    p.on('exit', () => done({ ok: false, reason: err.trim().slice(0, 200) || 'the helper stopped' }))
    setTimeout(() => done({ ok: false, reason: 'timed out' }), 10_000)
  })
}

export function registerStudioIpc(): void {
  ipcMain.handle(CH.studioAudioStart, () => startAudio())
  ipcMain.handle(CH.studioAudioStop, () => stopAudio())
  ipcMain.handle(CH.studioMic, (_e, on: boolean) => {
    micOpen = !!on
  })
  ipcMain.handle(CH.studioFrameCaptureStart, () => frameCaptureStart())
  ipcMain.handle(CH.studioFrameCaptureStop, () => frameCaptureStop())
  ipcMain.handle(CH.studioFrameRead, async (_e, index: number) => {
    const s = sink
    if (!s?.reader || !Number.isInteger(index) || index < 0 || index >= s.times.length) return null
    const buf = Buffer.allocUnsafe(s.lengths[index]!)
    await s.reader.read(buf, 0, buf.length, s.offsets[index]!)
    return buf
  })
  ipcMain.handle(CH.studioFrameCaptureClear, () => frameCaptureClear())
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
    setExporting(true)
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
    setExporting(false)
    void frameCaptureClear()
  })
  ipcMain.handle(CH.studioSaveImage, async (_e, videoPath: string, jpeg: Uint8Array) => {
    if (typeof videoPath !== 'string' || !videoPath.toLowerCase().endsWith('.mp4') || !(jpeg instanceof Uint8Array) || jpeg.byteLength > 20 * 1024 * 1024) return null
    const out = videoPath.replace(/\.mp4$/i, ' (cover).jpg')
    await writeFile(out, jpeg)
    return out
  })
  ipcMain.handle(CH.studioReveal, (_e, path: string) => {
    if (typeof path === 'string' && path.toLowerCase().endsWith('.mp4')) shell.showItemInFolder(path)
  })
}
