import { useEffect, useState } from 'react'
import { ACCEL_PATTERN, GLOBAL_SHORTCUTS, effectiveAccel, type ShortcutId } from '@shared/shortcuts'
import { useSettings } from '@/store/settings'
import { useUi } from '@/store/ui'

const pretty = (accel: string): string => accel.replace('Control', 'Ctrl').replace('Super', 'Win')

/** Turns a keydown into an Electron accelerator, or null if it isn't a valid global shortcut. */
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  let key: string | null = null
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code
  else if (e.code === 'Space') key = 'Space'
  else if (e.code === 'ArrowUp') key = 'Up'
  else if (e.code === 'ArrowDown') key = 'Down'
  else if (e.code === 'ArrowLeft') key = 'Left'
  else if (e.code === 'ArrowRight') key = 'Right'
  if (!key || !mods.some((m) => m !== 'Shift')) return null // need Ctrl, Alt or Win as well
  const accel = [...mods, key].join('+')
  return ACCEL_PATTERN.test(accel) ? accel : null
}

/** Global shortcut list with click-to-rebind. */
export function ShortcutEditor() {
  const enabled = useSettings((s) => s.settings.globalShortcuts)
  const overrides = useSettings((s) => s.settings.shortcuts)
  const set = useSettings((s) => s.set)
  const toast = useUi((s) => s.toast)
  const [recording, setRecording] = useState<ShortcutId | null>(null)
  const [failed, setFailed] = useState<string[]>([])

  // after any change, ask main which shortcuts another app already owns
  useEffect(() => {
    const t = setTimeout(() => void window.lyra.app.failedShortcuts().then(setFailed), 250)
    return () => clearTimeout(t)
  }, [overrides, enabled])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(null)
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return // wait for the real key
      const accel = toAccelerator(e)
      if (!accel) return toast('Use Ctrl, Alt or Win with a letter, number, F-key, arrow or Space.', 'error')
      const clash = GLOBAL_SHORTCUTS.find((g) => g.id !== recording && effectiveAccel(g.id, overrides) === accel)
      if (clash) return toast(`That’s already used for “${clash.label}”.`, 'error')
      set({ shortcuts: { ...overrides, [recording]: accel } })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, overrides, set, toast])

  return (
    <dl className="keys keys--edit">
      {GLOBAL_SHORTCUTS.map((k) => {
        const accel = effectiveAccel(k.id, overrides)
        const changed = k.id in overrides
        const bad = enabled && failed.includes(k.id)
        return (
          <div key={k.id} className={enabled ? '' : 'is-off'}>
            <dt>
              {k.label}
              {bad && <small className="keys__warn"> · in use by another app</small>}
            </dt>
            <dd>
              <button
                type="button"
                className={`keycap ${recording === k.id ? 'is-rec' : ''}`}
                onClick={() => setRecording(recording === k.id ? null : k.id)}
                aria-label={`Change shortcut for ${k.label}`}
              >
                {recording === k.id ? 'Press keys…' : pretty(accel)}
              </button>
              {changed && recording !== k.id && (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    const { [k.id]: _drop, ...rest } = overrides
                    void _drop
                    set({ shortcuts: rest })
                  }}
                >
                  reset
                </button>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
