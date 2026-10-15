import { motion } from 'framer-motion'
import { GLOBAL_SHORTCUTS, effectiveAccel } from '@shared/shortcuts'
import { useSettings } from '@/store/settings'
import { requestMode } from '@/store/ui'
import { Icon } from './Icon'

const pretty = (accel: string): string => accel.replace('Control', 'Ctrl').replace('Super', 'Win')

/** First-run card: what Lyra needs and the handful of things worth knowing. */
export function Welcome() {
  const set = useSettings((s) => s.set)
  const defaultMode = useSettings((s) => s.settings.defaultMode)
  const overrides = useSettings((s) => s.settings.shortcuts)
  const pick = (id: (typeof GLOBAL_SHORTCUTS)[number]['id']): string => pretty(effectiveAccel(id, overrides))

  const done = (): void => {
    set({ onboarded: true })
    requestMode(defaultMode === 'mini' ? 'mini' : defaultMode)
  }

  return (
    <motion.div
      className="welcome"
      role="dialog"
      aria-label="Welcome to Lyra"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="welcome__mark" aria-hidden="true">
        <Icon name="note" size={22} />
      </div>
      <h2>Welcome to Lyra</h2>
      <p className="welcome__lead">Beautiful, synced lyrics for the Spotify desktop app — no account or login.</p>
      <ol className="welcome__steps">
        <li>
          <b>Open the Spotify desktop app</b> and play a song. Lyra picks it up automatically.
        </li>
        <li>
          <b>Click the widget</b> to expand it; press <kbd>F</kbd> for fullscreen lyrics.
        </li>
        <li>
          Drag it anywhere, resize from the corner, minimize or hide to the tray.
        </li>
      </ol>
      <dl className="welcome__keys">
        <div>
          <dt>Show / hide</dt>
          <dd>{pick('toggle-visible')}</dd>
        </div>
        <div>
          <dt>Fullscreen</dt>
          <dd>{pick('toggle-fullscreen')}</dd>
        </div>
        <div>
          <dt>Play / pause</dt>
          <dd>{pick('toggle-play')}</dd>
        </div>
      </dl>
      <div className="welcome__actions">
        <button type="button" className="primary" onClick={done}>
          Get started
        </button>
        <button type="button" className="textbtn" onClick={() => void window.lyra.player.openInSpotify(null)}>
          Open Spotify
        </button>
      </div>
    </motion.div>
  )
}
