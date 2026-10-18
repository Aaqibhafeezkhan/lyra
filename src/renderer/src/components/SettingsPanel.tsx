import { useEffect, useState } from 'react'
import { LOCAL_SHORTCUTS } from '@shared/shortcuts'
import type { Settings, YoutubeVideo } from '@shared/types'
import { useBackgroundVersion } from '@/hooks/useBackground'
import { usePlayer } from '@/store/player'
import { ShortcutEditor } from './ShortcutEditor'
import { UpdateRow } from './UpdateRow'
import { useSettings } from '@/store/settings'
import { useUi } from '@/store/ui'

function Row({ label, hint, info, children }: { label: string; hint?: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="srow">
      <div className="srow__label">
        <span>
          {label}
          {info && (
            <i className="info" tabIndex={0} role="note" aria-label={info} data-tip={info}>
              i
            </i>
          )}
        </span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="srow__ctl">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
      <i />
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ v: T; label: string }>; onChange(v: T): void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? 'is-on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Slider({ value, min, max, step, onChange, label, format }: { value: number; min: number; max: number; step: number; onChange(v: number): void; label: string; format(v: number): string }) {
  return (
    <div className="sl">
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(value)}</output>
    </div>
  )
}

function ResetButton() {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={`pill ${armed ? 'pill--danger' : ''}`}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        void window.lyra.settings
          .reset()
          .then(() => useUi.getState().toast('Settings reset to defaults'))
          .catch(() => useUi.getState().toast('Couldn’t reset settings', 'error'))
      }}
    >
      {armed ? 'Click again to confirm' : 'Reset settings'}
    </button>
  )
}

function BackgroundSection() {
  const s = useSettings((x) => x.settings)
  const set = useSettings((x) => x.set)
  const track = usePlayer((x) => x.snapshot?.track ?? null)
  const bump = useBackgroundVersion((x) => x.bump)
  const toast = useUi((x) => x.toast)
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [cands, setCands] = useState<YoutubeVideo[] | null>(null)
  const videoOn = s.backgroundStyle !== 'still'
  const motionBlocked = s.reducedMotion === 'on' || (s.reducedMotion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    void window.lyra.background.hasYoutubeKey().then(setHasKey)
  }, [])

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | void>): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if (r && !r.ok && r.error) setMsg(r.error)
      bump()
    } catch {
      setMsg('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h4>Background</h4>
      <Row
        label="Video background"
        info="Plays a looping video behind the lyrics in cinematic mode. Lyra tries, in order: your own file, a free 30 s official clip from Apple, YouTube (only if you add a key), then animated cover art. Off = plain blurred cover."
        hint="Cinematic mode (mini player optional)"
      >
        <Toggle label="Video background" checked={videoOn} onChange={(v) => set({ backgroundStyle: v ? 'auto' : 'still' })} />
      </Row>
      {videoOn && motionBlocked && (
        <Row label="Reduce motion is on" hint="Videos can't play while it's on">
          <button type="button" className="pill" onClick={() => set({ reducedMotion: 'off' })}>
            Turn it off
          </button>
        </Row>
      )}
      {videoOn && (
        <>
          <small style={{ opacity: 0.7, display: 'block', padding: '2px 0 8px' }}>
            Order: your file for this song → your file for all songs → Apple clip (free) → YouTube (needs key) → animated cover art
          </small>
      <Row label="Dim" info="Darkens the video so lyrics stay readable. Lower = brighter video." hint="Keeps lyrics readable over video">
        <Slider label="Background dim" value={s.backgroundDim} min={0.2} max={0.9} step={0.02} onChange={(v) => set({ backgroundDim: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Auto dim" info="Lets Lyra darken bright scenes and ease off on dark ones, using the dim level above as the starting point, so lyrics stay readable without a dull picture.">
        <Toggle label="Auto dim" checked={s.autoDim} onChange={(v) => set({ autoDim: v })} />
      </Row>
      <Row label="Also in mini player" info="Show the animated background in the mini player too, not only in cinematic mode. Uses a little more CPU/GPU.">
        <Toggle label="Animated background in mini player" checked={s.backgroundInMini} onChange={(v) => set({ backgroundInMini: v })} />
      </Row>
      <Row label="Your file for all songs" info="Pick a GIF, image, MP4 or WebM to use behind every song. A copy is stored in Lyra's folder and never uploaded." hint={s.customBackground ? s.customBackground.name : 'GIF, image, MP4 or WebM · up to 200 MB'}>
        <button type="button" className="pill" disabled={busy} onClick={() => void run(() => window.lyra.background.pick('global'))}>
          {s.customBackground ? 'Change' : 'Choose'}
        </button>
        {s.customBackground && (
          <button type="button" className="pill" disabled={busy} onClick={() => void run(() => window.lyra.background.clear('global'))}>
            Remove
          </button>
        )}
      </Row>
      <Row label="This song" info="Pick a file used only for the song that is playing now. It beats every other background." hint={track ? `${track.title}: a file just for this track` : 'Play a song first'}>
        <button type="button" className="pill" disabled={busy || !track} onClick={() => track && void run(() => window.lyra.background.pick('song', track.id))}>
          Choose
        </button>
        <button type="button" className="pill" disabled={busy || !track} onClick={() => track && void run(() => window.lyra.background.clear('song', track.id))}>
          Remove
        </button>
      </Row>
      <Row label="YouTube video" info="Optional. A free YouTube Data API v3 key (Google Cloud Console) lets Lyra find the official music video and play it muted. The key is encrypted on this PC. Without it, Lyra uses Apple clips or animated art." hint={hasKey ? 'API key saved (encrypted). Official video plays muted' : 'Optional. Paste a free YouTube Data API v3 key'}>
        {hasKey ? (
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.lyra.background.clearYoutubeKey()
                setHasKey(false)
                toast('YouTube key removed')
              })
            }
          >
            Remove key
          </button>
        ) : (
          <>
            <input className="field" type="password" autoComplete="off" spellCheck={false} placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 150 }} />
            <button
              type="button"
              className="pill"
              disabled={busy || key.trim().length < 20}
              onClick={() =>
                void run(async () => {
                  const r = await window.lyra.background.setYoutubeKey(key)
                  if (r.ok) {
                    setHasKey(true)
                    setKey('')
                    toast('YouTube key saved')
                  }
                  return r
                })
              }
            >
              Save
            </button>
          </>
        )}
      </Row>
      {hasKey && track && (
        <Row label="Wrong video?" info="Lyra guesses the official video by title, artist and length. If it picked wrong, choose another here for this song." hint="Pick another for this song">
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await window.lyra.background.youtubeCandidates(track)
                setCands(r.items)
                if (r.error) return { ok: false, error: r.error }
              })
            }
          >
            Show options
          </button>
        </Row>
      )}
      {cands && track && (
        <div className="srow srow--actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {cands.length === 0 && <small>No embeddable videos found.</small>}
          {cands.map((c) => (
            <button
              key={c.videoId}
              type="button"
              className="pill"
              style={{ textAlign: 'left', whiteSpace: 'normal' }}
              onClick={() =>
                void run(async () => {
                  await window.lyra.background.youtubeChoose(track.id, c.videoId)
                  setCands(null)
                })
              }
            >
              {c.title} · {c.channel}
            </button>
          ))}
          <button
            type="button"
            className="pill"
            onClick={() =>
              void run(async () => {
                await window.lyra.background.youtubeChoose(track.id, null)
                setCands(null)
              })
            }
          >
            Use automatic pick
          </button>
        </div>
      )}
        </>
      )}
      {msg && (
        <small role="alert" style={{ color: 'var(--danger, #ff8a8a)' }}>
          {msg}
        </small>
      )}
      <small style={{ opacity: 0.7, display: 'block', paddingTop: 6 }}>
        Without a key, Lyra uses a free 30-second official clip from Apple when one exists, otherwise a living version of the cover art. Searching sends the song title and artist to Apple or Google.
      </small>
    </section>
  )
}

export function SettingsPanel() {
  const s = useSettings((x) => x.settings)
  const set = useSettings((x) => x.set)
  const status = usePlayer((x) => x.status)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.lyra.app.info().then((i) => setVersion(i.version))
  }, [])
  const up = <K extends keyof Settings>(k: K) => (v: Settings[K]) => set({ [k]: v } as Partial<Settings>)

  const active: 'local' | 'api' | 'demo' =
    status?.state === 'demo' ? 'demo' : status?.state === 'local' || (status?.state === 'offline' && s.source === 'local') ? 'local' : 'api'
  const account =
    status?.state === 'demo'
      ? 'Demo mode'
      : status?.state === 'local'
        ? 'Spotify desktop app'
        : status?.state === 'connected'
        ? `${status.userName ?? 'Connected'}${status.product ? ` · ${status.product}` : ''}`
        : status?.state === 'offline'
          ? 'Offline'
          : 'Not connected'

  return (
    <div className="settings" data-nodrag>
      <section>
        <h4>Music source</h4>
        <Segmented
          label="Music source"
          value={active}
          onChange={(v) => {
            if (v === 'local') void window.lyra.spotify.useLocal()
            else if (v === 'demo') void window.lyra.spotify.startDemo()
            else void window.lyra.spotify.connect()
          }}
          options={[
            { v: 'local', label: 'Windows (no login)' },
            { v: 'api', label: 'Spotify API' },
            { v: 'demo', label: 'Demo' }
          ]}
        />
        <Row
          label="Status"
          hint={
            status?.state === 'local'
              ? 'Reads the Spotify app via Windows media controls. No queue; likes are saved locally.'
              : status?.controlsLimited
                ? 'Free accounts can’t be remote-controlled — display only'
                : undefined
          }
        >
          <span className="value">{account}</span>
        </Row>
      </section>

      <section>
        <h4>Widget</h4>
        <Row label="Resting size">
          <Segmented
            label="Resting size"
            value={s.defaultMode}
            onChange={(v) => {
              set({ defaultMode: v })
              void window.lyra.window.setMode(v)
            }}
            options={[
              { v: 'minimal', label: 'Minimal' },
              { v: 'compact', label: 'Compact' },
              { v: 'mini', label: 'Expanded' }
            ]}
          />
        </Row>
        <Row label="Width">
          <Slider label="Widget width" value={s.compactWidth} min={320} max={520} step={10} onChange={up('compactWidth')} format={(v) => `${v}px`} />
        </Row>
        <Row label="Opacity">
          <Slider label="Opacity" value={s.opacity} min={0.4} max={1} step={0.02} onChange={up('opacity')} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Always on top">
          <Toggle label="Always on top" checked={s.alwaysOnTop} onChange={up('alwaysOnTop')} />
        </Row>
        <Row label="Fade when idle" hint="Dim the widget when the cursor leaves">
          <Toggle label="Fade when idle" checked={s.autoHide} onChange={up('autoHide')} />
        </Row>
        <Row label="Hide while screen sharing" hint="Excluded from captures & recordings">
          <Toggle label="Hide while screen sharing" checked={s.hideOnScreenShare} onChange={up('hideOnScreenShare')} />
        </Row>
      </section>

      <section>
        <h4>Lyrics</h4>
        <Row label="Typeface">
          <Segmented
            label="Typeface"
            value={s.lyricFont}
            onChange={up('lyricFont')}
            options={[
              { v: 'sans', label: 'Sans' },
              { v: 'serif', label: 'Serif' },
              { v: 'rounded', label: 'Round' },
              { v: 'mono', label: 'Mono' }
            ]}
          />
        </Row>
        <Row label="Size">
          <Slider label="Lyric size" value={s.lyricFontSize} min={24} max={72} step={2} onChange={up('lyricFontSize')} format={(v) => `${v}px`} />
        </Row>
        <Row label="Line spacing">
          <Slider label="Line spacing" value={s.lineSpacing} min={1} max={2} step={0.05} onChange={up('lineSpacing')} format={(v) => v.toFixed(2)} />
        </Row>
        <Row label="Animation">
          <Segmented
            label="Lyric animation"
            value={s.lyricAnimation}
            onChange={up('lyricAnimation')}
            options={[
              { v: 'glide', label: 'Glide' },
              { v: 'focus', label: 'Focus' },
              { v: 'fade', label: 'Fade' }
            ]}
          />
        </Row>
        <Row label="Default sync offset" hint="Every song. Fine-tune under the lyrics">
          <Slider label="Sync offset" value={s.lyricOffsetMs} min={-3000} max={3000} step={50} onChange={up('lyricOffsetMs')} format={(v) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(2)}s`} />
        </Row>
      </section>

      <section>
        <h4>Appearance</h4>
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={s.theme}
            onChange={up('theme')}
            options={[
              { v: 'adaptive', label: 'Artwork' },
              { v: 'dark', label: 'Dark' },
              { v: 'light', label: 'Light' }
            ]}
          />
        </Row>
        <Row label="Reduce motion">
          <Segmented
            label="Reduce motion"
            value={s.reducedMotion}
            onChange={up('reducedMotion')}
            options={[
              { v: 'system', label: 'System' },
              { v: 'on', label: 'On' },
              { v: 'off', label: 'Off' }
            ]}
          />
        </Row>
      </section>

      <BackgroundSection />

      <section>
        <h4>System</h4>
        <Row label="Launch at startup" hint="Applies to installed builds">
          <Toggle label="Launch at startup" checked={s.launchAtStartup} onChange={up('launchAtStartup')} />
        </Row>
        <Row label="Control system volume" hint="Windows source. Loads a helper that some antivirus tools flag">
          <Toggle label="Control system volume" checked={s.systemVolume} onChange={up('systemVolume')} />
        </Row>
        <Row label="Global shortcuts">
          <Toggle label="Global shortcuts" checked={s.globalShortcuts} onChange={up('globalShortcuts')} />
        </Row>
        <Row label="Track change notifications">
          <Toggle label="Track change notifications" checked={s.trackNotifications} onChange={up('trackNotifications')} />
        </Row>
      </section>

      <section>
        <h4>Shortcuts</h4>
        <ShortcutEditor />
        <dl className="keys">
          {LOCAL_SHORTCUTS.map((k) => (
            <div key={k.keys}>
              <dt>{k.label}</dt>
              <dd>{k.keys}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="srow srow--actions">
        <button type="button" className="pill" onClick={() => window.lyra.window.hide()}>
          Hide to tray
        </button>
        <button
          type="button"
          className="pill"
          onClick={() =>
            void window.lyra.app
              .diagnostics()
              .then((t) => window.lyra.app.copy(t))
              .then(() => useUi.getState().toast('Diagnostics copied — paste it into your bug report'))
              .catch(() => useUi.getState().toast('Couldn’t copy diagnostics', 'error'))
          }
        >
          Copy diagnostics
        </button>
        <ResetButton />
        <button type="button" className="pill" onClick={() => window.lyra.window.quit()}>
          Quit Lyra
        </button>
      </div>

      <section className="about">
        <h4>About</h4>
        <UpdateRow />
        <p className="about__name">
          <b>Lyra</b> <span>{version ? `v${version}` : ''}</span>
        </p>
        <p>A free, account-free lyrics companion for the Spotify desktop app. Everything runs on your PC.</p>
        <ul>
          <li>
            Lyrics from{' '}
            <a href="https://lrclib.net" target="_blank" rel="noreferrer">
              LRCLIB
            </a>
            , release years from{' '}
            <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">
              MusicBrainz
            </a>
            . Lyrics belong to their rights holders.
          </li>
          <li>Only the song title, artist, album and length are sent to those services — nothing else leaves your PC. No accounts, no analytics.</li>
          <li>Lyra is an independent project, not affiliated with or endorsed by Spotify. Spotify is a trademark of Spotify AB.</li>
        </ul>
        <p>
          <a href="https://github.com/DhruvHarani1/lyra" target="_blank" rel="noreferrer">
            Source code &amp; privacy details
          </a>{' '}
          · MIT licensed
        </p>
      </section>
    </div>
  )
}
