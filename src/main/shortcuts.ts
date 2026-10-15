import { globalShortcut } from 'electron'
import { EV } from '@shared/ipc'
import { GLOBAL_SHORTCUTS } from '@shared/shortcuts'
import type { AppCommand } from '@shared/types'
import { createLogger } from './logger'
import { windows } from './window'

const log = createLogger('shortcuts')

function send(cmd: AppCommand): void {
  windows.window?.webContents.send(EV.command, cmd)
}

const ACTIONS: Record<(typeof GLOBAL_SHORTCUTS)[number]['id'], () => void> = {
  'toggle-play': () => send('toggle-play'),
  next: () => send('next'),
  previous: () => send('previous'),
  'toggle-expand': () => {
    windows.show()
    windows.toggleExpand()
  },
  'toggle-fullscreen': () => {
    windows.show()
    windows.toggleFullscreen()
  },
  'toggle-visible': () => windows.toggleVisible()
}

export function applyShortcuts(enabled: boolean): void {
  globalShortcut.unregisterAll()
  if (!enabled) return
  for (const s of GLOBAL_SHORTCUTS) {
    try {
      if (!globalShortcut.register(s.accel, ACTIONS[s.id])) log.warn(`could not register ${s.accel} (already taken?)`)
    } catch (e) {
      log.warn(`failed to register ${s.accel}`, e)
    }
  }
}

export function disposeShortcuts(): void {
  globalShortcut.unregisterAll()
}
