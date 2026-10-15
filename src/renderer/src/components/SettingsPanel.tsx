import { useEffect, useState } from 'react'
import { GLOBAL_SHORTCUTS, LOCAL_SHORTCUTS } from '@shared/shortcuts'
import type { Settings } from '@shared/types'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="srow">
      <div className="srow__label">
        <span>{label}</span>
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
        <Row label="Default sync offset" hint="Applied to every song. Fine-tune per song under the lyrics">
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
        <dl className="keys">
          {GLOBAL_SHORTCUTS.map((k) => (
            <div key={k.id} className={s.globalShortcuts ? '' : 'is-off'}>
              <dt>{k.label}</dt>
              <dd>{k.accel.replace('Control', 'Ctrl')}</dd>
            </div>
          ))}
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
        <button type="button" className="pill" onClick={() => window.lyra.window.quit()}>
          Quit Lyra
        </button>
      </div>

      <p className="settings__about">Lyra {version} · Lyrics from LRCLIB · Playback via Spotify</p>
    </div>
  )
}
