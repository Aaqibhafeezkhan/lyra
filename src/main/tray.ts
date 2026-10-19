import { Menu, Tray, app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppCommand } from '@shared/types'
import { windows } from './window'
import { settings } from './settings'

let tray: Tray | null = null

/** Draws the app glyph (three rounded bars on a soft square) as a BGRA bitmap. No asset files needed. */
function makeIcon(size: number): NativeImage {
  const buf = Buffer.alloc(size * size * 4)
  const bars = [
    { x: 0.27, h: 0.34 },
    { x: 0.5, h: 0.58 },
    { x: 0.73, h: 0.42 }
  ]
  const r = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // rounded square mask
      const dx = Math.max(r - x, 0, x - (size - 1 - r))
      const dy = Math.max(r - y, 0, y - (size - 1 - r))
      const inside = dx * dx + dy * dy <= r * r
      if (!inside) continue
      let v = 22 // bg
      for (const b of bars) {
        const cx = b.x * size
        const half = (b.h * size) / 2
        const w = size * 0.075
        const cy = size / 2
        const ddx = Math.abs(x - cx) - w
        const ddy = Math.abs(y - cy) - (half - w)
        const d = Math.hypot(Math.max(ddx, 0), Math.max(ddy, 0))
        if (d <= w) v = 245
      }
      buf[i] = v
      buf[i + 1] = v
      buf[i + 2] = v
      buf[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function send(cmd: AppCommand): void {
  windows.sendCommand(cmd)
}

export function createTray(): Tray {
  tray = new Tray(appIcon().resize({ width: 32, height: 32 }))
  tray.setToolTip('Lyra')
  const rebuild = (): void => {
    const s = settings.get()
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show / hide widget', click: () => windows.toggleVisible() },
        { label: 'Fullscreen lyrics', click: () => { windows.show(); windows.setMode('full') } },
        { type: 'separator' },
        { label: 'Play / pause', click: () => send('toggle-play') },
        { label: 'Next', click: () => send('next') },
        { label: 'Previous', click: () => send('previous') },
        { type: 'separator' },
        {
          label: 'Always on top',
          type: 'checkbox',
          checked: s.alwaysOnTop,
          click: (i) => settings.update({ alwaysOnTop: i.checked })
        },
        { label: 'Settings…', click: () => { windows.show(); if (windows.getMode() !== 'mini') windows.setMode('mini'); send('open-settings') } },
        { type: 'separator' },
        { label: 'Quit Lyra', click: () => app.quit() }
      ])
    )
  }
  rebuild()
  settings.on('change', rebuild)
  tray.on('click', () => windows.toggleVisible())
  return tray
}

/** The real icon (resources/icon.png) when present, else the generated glyph. */
export function appIcon(): NativeImage {
  const candidates = [join(process.resourcesPath ?? '', 'icon.png'), join(app.getAppPath(), 'resources', 'icon.png')]
  const file = candidates.find((p) => existsSync(p))
  if (file) {
    const img = nativeImage.createFromPath(file)
    if (!img.isEmpty()) return img
  }
  return makeIcon(256)
}
