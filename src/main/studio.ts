import { app, dialog, ipcMain, shell } from 'electron'
import { open, rm, type FileHandle } from 'node:fs/promises'
import { CH } from '@shared/ipc'
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

export function registerStudioIpc(): void {
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
