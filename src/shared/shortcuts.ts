import type { FullLayout } from './types'

/** Global (system-wide) shortcuts. Shared so Settings can show exactly what main registers. */
export const GLOBAL_SHORTCUTS = [
  { id: 'toggle-play', accel: 'Control+Alt+P', label: 'Play / pause' },
  { id: 'next', accel: 'Control+Alt+Right', label: 'Next track' },
  { id: 'previous', accel: 'Control+Alt+Left', label: 'Previous track' },
  { id: 'toggle-expand', accel: 'Control+Alt+L', label: 'Expand / collapse' },
  { id: 'toggle-fullscreen', accel: 'Control+Alt+F', label: 'Fullscreen lyrics' },
  { id: 'toggle-visible', accel: 'Control+Alt+H', label: 'Show / hide widget' }
] as const

/** In-app shortcuts (active while the widget is focused). */
export const LOCAL_SHORTCUTS = [
  { keys: 'Space', label: 'Play / pause' },
  { keys: '← / →', label: 'Seek 5 s' },
  { keys: 'Shift + ← / →', label: 'Previous / next track' },
  { keys: '↑ / ↓', label: 'Volume' },
  { keys: 'F', label: 'Fullscreen' },
  { keys: 'Esc', label: 'Exit fullscreen / collapse' },
  { keys: 'D', label: 'Distraction-free (fullscreen)' },
  { keys: '[ / ]', label: 'Lyrics later / earlier (fullscreen)' },
  { keys: '1 / 2 / 3', label: 'Cinema / Split / Poster layout (fullscreen)' },
  { keys: 'L', label: 'Flip lyric side (fullscreen)' }
] as const

export type FullscreenShortcutAction =
  | { type: 'nudge'; direction: -1 | 1 }
  | { type: 'layout'; layout: FullLayout }
  | { type: 'flip-side' }

/** Resolve fullscreen-only keys; editable controls must keep their normal typing behaviour. */
export function getFullscreenShortcutAction(key: string, isEditable = false): FullscreenShortcutAction | null {
  if (isEditable) return null
  switch (key) {
    case '[':
      return { type: 'nudge', direction: -1 }
    case ']':
      return { type: 'nudge', direction: 1 }
    case '1':
      return { type: 'layout', layout: 'cinema' }
    case '2':
      return { type: 'layout', layout: 'split' }
    case '3':
      return { type: 'layout', layout: 'poster' }
    case 'l':
    case 'L':
      return { type: 'flip-side' }
    default:
      return null
  }
}

export type ShortcutId = (typeof GLOBAL_SHORTCUTS)[number]['id']

/** The accelerator actually in effect for a shortcut (user override or default). */
export function effectiveAccel(id: ShortcutId, overrides: Record<string, string>): string {
  return overrides[id] ?? GLOBAL_SHORTCUTS.find((s) => s.id === id)!.accel
}

/** Safe shape for an Electron accelerator we are willing to register. */
export const ACCEL_PATTERN = /^(?:(?:Control|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Up|Down|Left|Right)$/
