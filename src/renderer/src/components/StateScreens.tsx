import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUi } from '@/store/ui'
import { Icon } from './Icon'
import { Artwork } from './Artwork'

const REDIRECT_URI = 'http://127.0.0.1:53682/callback'

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="progressbar" aria-label="Loading" />
}

export function LoadingScreen() {
  return (
    <div className="screen screen--center" aria-busy="true">
      <Spinner size={22} />
      <p className="screen__sub">Looking for your music…</p>
    </div>
  )
}

/** Android: one permission lets Lyra see what any music app is playing. No account, no Spotify login. */
function AndroidSetup() {
  return (
    <div className="screen screen--center">
      <div className="screen__icon">
        <Icon name="note" size={26} />
      </div>
      <h2 className="screen__title">Let Lyra see what’s playing</h2>
      <p className="screen__sub">
        Turn on <strong>Lyra</strong> under “Notification access”. Lyra only reads the now-playing card of your music app (title, artist, position). It never reads your notifications.
      </p>
      <div className="screen__actions">
        <button type="button" className="pill pill--primary" onClick={() => void window.lyra.android?.openAccessSettings()}>
          Open settings
        </button>
      </div>
    </div>
  )
}

/** Spotify sign-in & setup. Guides the user through registering their own Spotify app. */
export function ConnectScreen() {
  if (document.documentElement.dataset.platform === 'android') return <AndroidSetup />
  return <DesktopConnect />
}

function DesktopConnect() {
  const status = usePlayer((s) => s.status)
  const savedId = useSettings((s) => s.settings.spotifyClientId)
  const [envId, setEnvId] = useState(false)
  const [id, setId] = useState(savedId)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useUi((s) => s.toast)
  const connecting = status?.state === 'connecting'

  useEffect(() => {
    void window.lyra.app.info().then((i) => setEnvId(i.envClientId))
  }, [])

  const hasId = !!(savedId || envId)
  const showSetup = !hasId || editing

  const copy = async (): Promise<void> => {
    try {
      if (!(await window.lyra.app.copy(REDIRECT_URI))) throw new Error('copy failed')
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast('Couldn’t copy — select the address manually.', 'error')
    }
  }

  const connect = (): void => {
    void window.lyra.spotify.connect(showSetup && id.trim() ? id.trim() : undefined)
  }

  return (
    <div className="screen connect">
      <div className="connect__mark" aria-hidden="true">
        <Icon name="note" size={22} />
      </div>
      <h2 className="screen__title">{connecting ? 'Waiting for Spotify…' : 'Connect Spotify'}</h2>
      <p className="screen__sub">
        {connecting
          ? 'Approve access in the browser window that just opened. This window updates automatically.'
          : 'Lyra reads what’s playing and controls it through Spotify’s official API. Your password is never seen or stored.'}
      </p>

      {status?.message && !connecting && (
        <p className="notice notice--error" role="alert">
          <Icon name="alert" size={14} /> {status.message}
        </p>
      )}

      {connecting ? (
        <div className="connect__actions">
          <Spinner />
          <button type="button" className="textbtn" onClick={() => void window.lyra.spotify.disconnect()}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          {showSetup && (
            <ol className="steps" data-nodrag>
              <li>
                Create an app in the{' '}
                <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                  Spotify Developer Dashboard
                </a>
                .
              </li>
              <li>
                Add this Redirect URI:
                <button type="button" className="chip" onClick={copy} title="Copy">
                  <code>{REDIRECT_URI}</code>
                  <Icon name={copied ? 'check' : 'copy'} size={13} />
                </button>
              </li>
              <li>
                Paste its <b>Client ID</b> (no secret needed):
                <input
                  className="field"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="32-character Client ID"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && id.trim().length >= 20 && connect()}
                />
              </li>
            </ol>
          )}
          <div className="connect__actions" data-nodrag>
            <button type="button" className="primary" disabled={showSetup && id.trim().length < 20} onClick={connect}>
              Connect with Spotify
            </button>
            <button
              type="button"
              className="textbtn"
              onClick={() => void window.lyra.spotify.startDemo()}
              title="Explore the interface with simulated playback"
            >
              Try demo mode
            </button>
          </div>
          {hasId && !editing && (
            <button type="button" className="textbtn textbtn--quiet" data-nodrag onClick={() => setEditing(true)}>
              Use a different Client ID
            </button>
          )}
        </>
      )}
    </div>
  )
}

export function NoMusicScreen({ ad = false }: { ad?: boolean }) {
  const recent = usePlayer((s) => s.recent)
  const refreshRecent = usePlayer((s) => s.refreshRecent)
  const status = usePlayer((s) => s.status)
  useEffect(() => {
    void refreshRecent()
  }, [refreshRecent])

  return (
    <div className="screen screen--center">
      <div className="empty__glyph" aria-hidden="true">
        <Icon name="note" size={26} />
      </div>
      <h2 className="screen__title">{ad ? 'Advertisement playing' : 'Nothing playing'}</h2>
      <p className="screen__sub">
        {ad
          ? 'Lyrics will return when your music does.'
          : status?.state === 'demo'
            ? 'Demo is idle.'
            : 'Press play in Spotify on any device and it will appear here.'}
      </p>
      <button type="button" className="pill" data-nodrag onClick={() => void window.lyra.player.openInSpotify(null)}>
        <Icon name="external" size={14} /> Open Spotify
      </button>
      {recent && recent.length > 0 && (
        <div className="recent" data-nodrag>
          <h4>Recently played</h4>
          {recent.slice(0, 4).map((r, i) => (
            <div key={`${r.id}-${i}`} className="recent__row">
              <Artwork url={r.artworkUrl} size={32} radius={6} />
              <div>
                <b>{r.title}</b>
                <span>{r.artists.join(', ')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function OfflineScreen() {
  const status = usePlayer((s) => s.status)
  return (
    <div className="screen screen--center">
      <div className="empty__glyph empty__glyph--warn" aria-hidden="true">
        <Icon name="wifiOff" size={26} />
      </div>
      <h2 className="screen__title">Can’t reach Spotify</h2>
      <p className="screen__sub">{status?.message ?? 'Something is blocking the connection.'}</p>
      {status?.retryInSec ? <RetryCountdown seconds={status.retryInSec} /> : null}
      <button type="button" className="textbtn" data-nodrag onClick={() => void window.lyra.spotify.disconnect()}>
        Sign out and reconnect
      </button>
    </div>
  )
}

function RetryCountdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    setLeft(seconds)
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(t)
  }, [seconds])
  return (
    <p className="screen__hint">
      <Spinner size={12} /> Retrying in {left}s
    </p>
  )
}

/** Thin banner shown over a playing UI when the connection drops. */
export function OfflineBanner() {
  const status = usePlayer((s) => s.status)
  if (status?.state !== 'offline') return null
  return (
    <motion.div className="banner" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="status">
      <Icon name="wifiOff" size={13} /> {status.message ?? 'Connection lost'} — showing last known state
    </motion.div>
  )
}

/** Compact one-line status used by the small widget sizes. */
export function WidgetStatus({ view }: { view: 'loading' | 'connect' | 'offline' | 'idle' | 'ad' }) {
  const status = usePlayer((s) => s.status)
  const text =
    view === 'loading'
      ? 'Looking for your music…'
      : view === 'connect'
        ? status?.state === 'connecting'
          ? 'Waiting for Spotify approval…'
          : 'Spotify isn’t connected'
        : view === 'offline'
          ? 'Can’t reach Spotify'
          : view === 'ad'
            ? 'Advertisement playing'
            : 'Nothing playing'
  const sub =
    view === 'connect'
      ? 'Click to set up'
      : view === 'offline'
        ? (status?.message ?? '')
        : view === 'idle'
          ? 'Play something in Spotify'
          : ''
  return (
    <div className="wstatus">
      <div className="wstatus__glyph">
        {view === 'loading' ? <Spinner size={16} /> : <Icon name={view === 'offline' ? 'wifiOff' : 'note'} size={18} />}
      </div>
      <div className="wstatus__text">
        <b>{text}</b>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  )
}
