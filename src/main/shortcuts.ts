import { globalShortcut } from 'electron'
import { EV } from '@shared/ipc'
import { GLOBAL_SHORTCUTS, effectiveAccel } from '@shared/shortcuts'
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

let failed: string[] = []

/** Ids of shortcuts that could not be registered (taken by another app). */
export function failedShortcuts(): string[] {
  return failed
}

export function applyShortcuts(enabled: boolean, overrides: Record<string, string> = {}): string[] {
  globalShortcut.unregisterAll()
  failed = []
  if (!enabled) return failed
  for (const s of GLOBAL_SHORTCUTS) {
    const accel = effectiveAccel(s.id, overrides)
    try {
      if (!globalShortcut.register(accel, ACTIONS[s.id])) {
        failed.push(s.id)
        log.warn(`could not register ${accel} (already taken?)`)
      }
    } catch (e) {
      failed.push(s.id)
      log.warn(`failed to register ${accel}`, e)
    }
  }
  return failed
}

export function disposeShortcuts(): void {
  globalShortcut.unregisterAll()
}
