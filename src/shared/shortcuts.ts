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
  { keys: '[ / ]', label: 'Lyrics later / earlier' }
] as const
