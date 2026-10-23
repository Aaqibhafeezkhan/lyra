import { useEffect, useState } from 'react'
import { LOCAL_SHORTCUTS } from '@shared/shortcuts'
import type { Settings, YoutubeVideo } from '@shared/types'
import { useBackgroundVersion } from '@/hooks/useBackground'
import { usePlayer } from '@/store/player'
import { ShortcutEditor } from './ShortcutEditor'
import { UpdateRow } from './UpdateRow'
import { useSettings } from '@/store/settings'
import { roomLink, useRoom } from '@/store/room'
import { useJam } from '@/store/jam'
import QRCode from 'qrcode'
import { useUi } from '@/store/ui'

/** Copy text and tell the user it worked (or didn't). */
async function copyWithToast(text: string, what: string): Promise<void> {
  let ok = false
  try {
    ok = await window.lyra.app.copy(text)
  } catch {
    ok = false
  }
  if (!ok) {
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      ok = false
    }
  }
  useUi.getState().toast(ok ? `${what} copied` : 'Couldn’t copy. Select the link and copy it by hand', ok ? undefined : 'error')
}

function RoomPanel() {
  const { code, guests, state, error, start, stop } = useRoom()
  const [qr, setQr] = useState<string | null>(null)
  const link = code ? roomLink(code) : ''
  useEffect(() => {
    if (!link) return setQr(null)
    void QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: '#0a0a0a', light: '#ffffff' } }).then(setQr)
  }, [link])
  return (
    <>
      <Row label="Host a room" hint="Share a link: friends open it in any browser and see your synced lyrics live. Friends with Lyra can also join to listen in sync with you">
        {state === 'idle' || state === 'error' ? (
          <button
            type="button"
            className="pill"
            onClick={() => {
              useJam.getState().leave()
              start()
            }}
          >
            Start a room
          </button>
        ) : (
          <button type="button" className="pill" onClick={stop}>
            Stop room
          </button>
        )}
      </Row>
      {error && <p className="hint">{error}</p>}
      {state === 'starting' && <p className="hint">Opening the room…</p>}
      {state === 'live' && code && (
        <div className="tvlink">
          {qr && <img src={qr} width={150} height={150} alt="QR code for the room link" />}
          <div>
            <p className="hint">
              Room <b>{code}</b> · {guests} {guests === 1 ? 'person' : 'people'} watching. Guests connect straight to this device, so they can see its network address. Stop the room any time.
            </p>
            <code onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>{link}</code>
            <button type="button" className="pill" onClick={() => void copyWithToast(link, 'Room link')}>
              Copy link
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** Join someone else's room from inside Lyra and listen in sync. */
function JamPanel() {
  const { status, message, host, needSong, syncing, syncOn, setSync, join, leave } = useJam()
  const [text, setText] = useState('')
  const active = status === 'joining' || status === 'connected'
  return (
    <>
      <Row label="Join a room" hint="Paste a room link or code. Everyone plays the same song in their own Spotify; Lyra keeps your play, pause and position in step with the host">
        {active ? (
          <button type="button" className="pill" onClick={leave}>
            Leave room
          </button>
        ) : null}
      </Row>
      {!active && (
        <form
          className="joinrow"
          onSubmit={(e) => {
            e.preventDefault()
            useRoom.getState().stop()
            join(text)
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Room link or code" aria-label="Room link or code" spellCheck={false} />
          <button type="submit" className="pill" disabled={!text.trim()}>
            Join
          </button>
        </form>
      )}
      {message && <p className="hint">{message}</p>}
      {status === 'joining' && <p className="hint">Joining…</p>}
      {status === 'connected' && (
        <div className="jam">
          <p className="hint">
            In the room · {host?.trackId ? <b>{host.title}</b> : 'the host is not playing yet'}
            {host?.trackId ? ` · ${host.artists} · ${host.playing ? 'playing' : 'paused'}` : ''}
          </p>
          {needSong && (
            <p className="hint">
              Play <b>{needSong.title}</b> by {needSong.artists} in your player.{' '}
              <a href={`https://open.spotify.com/search/${encodeURIComponent(`${needSong.title} ${needSong.artists}`)}`} target="_blank" rel="noreferrer">
                Find it in Spotify
              </a>
            </p>
          )}
          {!needSong && host?.trackId && <p className="hint">{syncOn ? (syncing ? 'Syncing with the host…' : 'In sync ✓') : 'Sync is off: you are playing on your own.'}</p>}
          <Row label="Keep my player in sync" hint="Matches the host's play, pause and position">
            <Toggle label="Keep my player in sync" checked={syncOn} onChange={setSync} />
          </Row>
        </div>
      )}
    </>
  )
}

/** Hosting and joining live side by side so it is obvious what each one does. */
function RoomHub() {
  const roomState = useRoom((r) => r.state)
  const jamStatus = useJam((j) => j.status)
  const [mode, setMode] = useState<'host' | 'join'>(jamStatus === 'idle' ? 'host' : 'join')
  const shown = roomState === 'live' || roomState === 'starting' ? 'host' : jamStatus === 'connected' || jamStatus === 'joining' ? 'join' : mode
  return (
    <>
      <Segmented<'host' | 'join'>
        label="Room role"
        value={shown}
        onChange={setMode}
        options={[
          { v: 'host', label: 'Host a room' },
          { v: 'join', label: 'Join a room' }
        ]}
      />
      {shown === 'host' ? <RoomPanel /> : <JamPanel />}
    </>
  )
}

function TvLink() {
  const [info, setInfo] = useState<{ running: boolean; urls: string[]; qr: string | null } | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => void window.lyra.lan.info().then((i) => alive && setInfo(i))
    load()
    const id = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!info) return null
  if (!info.running || !info.urls.length) return <p className="hint">Starting… If nothing appears, check that you are connected to Wi-Fi or a network.</p>
  return (
    <div className="tvlink">
      {info.qr && <img src={info.qr} width={150} height={150} alt="QR code for the TV link" />}
      <div>
        <p className="hint">Open this on any device on the same Wi-Fi. Keep the link private: anyone who has it can see what you play.</p>
        <code onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>{info.urls[0]}</code>
        <button type="button" className="pill" onClick={() => void copyWithToast(info.urls[0]!, 'TV link')}>
          Copy link
        </button>
      </div>
    </div>
  )
}

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
      {options.map((o, index) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          // roving focus: the chosen option is the tab stop (the first one when none matches, so the group is never unreachable)
          tabIndex={value === o.v || (index === 0 && !options.some((x) => x.v === value)) ? 0 : -1}
          className={value === o.v ? 'is-on' : ''}
          onClick={() => onChange(o.v)}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
            e.preventDefault()
            const nextIndex =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? options.length - 1
                  : (index + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            const next = options[nextIndex]!
            onChange(next.v)
            e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus()
          }}
        >
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
      {document.documentElement.dataset.platform !== 'android' && (
      <Row label="Also in mini player" info="Show the animated background in the mini player too, not only in cinematic mode. Uses a little more CPU/GPU.">
        <Toggle label="Animated background in mini player" checked={s.backgroundInMini} onChange={(v) => set({ backgroundInMini: v })} />
      </Row>
      )}
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

/** Android only: keep the screen on / keep Lyra from being closed while you listen. */
function PhoneSection() {
  const s = useSettings((x) => x.settings)
  const set = useSettings((x) => x.set)
  const toast = useUi((x) => x.toast)
  const [overlay, setOverlay] = useState(false)
  useEffect(() => {
    void window.lyra.android?.overlayState().then((st) => setOverlay(st.enabled && st.canDraw))
  }, [])
  const [lyricsNote, setLyricsNote] = useState({ enabled: false, public: true })
  useEffect(() => {
    void window.lyra.android?.lyricsNotification().then(setLyricsNote)
  }, [])
  const changeLyricsNote = async (next: { enabled: boolean; public: boolean }): Promise<void> => {
    setLyricsNote(next)
    await window.lyra.android?.setLyricsNotification(next.enabled, next.public)
  }
  const toggleOverlay = async (on: boolean): Promise<void> => {
    const r = await window.lyra.android?.setOverlay(on)
    if (r?.needsPermission) toast('Turn on “Display over other apps” for Lyra, then come back and switch this on again.')
    else setOverlay(on)
  }
  return (
    <section>
      <h4>Phone</h4>
      <Row label="Keep screen on while playing" info="Stops the screen from turning off while a song is playing and Lyra is open, so the lyrics stay visible. Uses more battery." hint="Only while music plays">
        <Toggle label="Keep screen on while playing" checked={s.keepScreenOn} onChange={(v) => set({ keepScreenOn: v })} />
      </Row>
      <Row label="Keep Lyra running" info="Runs a small background service (with one quiet notification) so Android doesn’t close Lyra while you listen. Turn it off any time." hint="Shows a notification">
        <Toggle label="Keep Lyra running" checked={s.keepRunning} onChange={(v) => set({ keepRunning: v })} />
      </Row>
      <Row label="Lyrics notification" info="One quiet notification with the current line, the next lines, the cover and play controls. It appears in the notification shade and on the lock screen; tap it to open Lyra over the lock screen without unlocking." hint="Shade and lock screen">
        <Toggle label="Lyrics notification" checked={lyricsNote.enabled} onChange={(v) => void changeLyricsNote({ ...lyricsNote, enabled: v })} />
      </Row>
      {lyricsNote.enabled && (
        <Row label="Show lyrics on lock screen" info="When off, the lock screen only says “Lyrics are on” and hides the lines until you unlock. Turn it off if you don’t want people nearby to read what you listen to." hint="Visible to anyone who sees the screen">
          <Toggle label="Show lyrics on lock screen" checked={lyricsNote.public} onChange={(v) => void changeLyricsNote({ ...lyricsNote, public: v })} />
        </Row>
      )}
      <Row label="Ambient style" info="Minimal: pure black with dim lyrics. Glow: the cover’s colours as a very dim moving glow. Video: the music video (or your own) played very dim. All keep the screen at minimum brightness.">
        <Segmented
          label="Ambient style"
          value={s.ambientStyle}
          onChange={(v) => set({ ambientStyle: v })}
          options={[
            { v: 'minimal', label: 'Minimal' },
            { v: 'glow', label: 'Glow' },
            { v: 'video', label: 'Video' }
          ]}
        />
      </Row>
      <Row label="Auto brightness" info="Uses the phone’s light sensor: ambient mode is very dim in a dark room and a little brighter in daylight. The brightness slider below is still what you set: Auto just lowers it a little in a dark room." hint="Follows the room light">
        <Toggle label="Auto brightness" checked={s.ambientAutoBrightness} onChange={(v) => set({ ambientAutoBrightness: v })} />
      </Row>
      <Row label="Ambient brightness" info="How bright the phone screen is in ambient mode. Keep it low for the bedside and to save battery. You can also change it on the ambient screen itself: touch it once.">
        <Slider label="Ambient brightness" value={s.ambientBrightness} min={0.04} max={0.6} step={0.01} onChange={(v) => set({ ambientBrightness: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Ambient screen" info="A very dim lyrics screen for your desk or bedside, like an always-on display. It uses minimum brightness and slowly shifts so an OLED screen isn’t worn. Touching the screen does nothing: switch it off with the same button, the Quick Settings tile, the home-screen widget or Back. You can also pick Lyra under Settings → Display → Screen saver so it appears by itself while charging." hint="On / off">
        <button type="button" className="pill" onClick={() => void window.lyra.android?.toggleAmbient()}>
          Switch on / off
        </button>
      </Row>
      <Row label="Ambient shortcuts" info="Add the Lyra ambient tile to Quick Settings for a one-tap switch. For the home screen, long-press the home screen → Widgets → Lyra → Ambient, or long-press the Lyra app icon → Ambient." hint="Tile, widget, app-icon shortcut">
        <button type="button" className="pill" onClick={() => void window.lyra.android?.addAmbientTile()}>
          Add tile
        </button>
      </Row>
      <Row label="Floating lyrics" info="Shows a small lyrics widget over other apps while music plays, so you can read along while using something else. It hides while Lyra is open. Needs Android’s “Display over other apps” permission." hint="Over other apps">
        <Toggle label="Floating lyrics widget" checked={overlay} onChange={(v) => void toggleOverlay(v)} />
      </Row>
      <Row label="Battery" info="Samsung and other phones may still close apps to save power. Set Lyra to “Unrestricted” (or choose “Don’t optimise”) so it keeps working with the screen off." hint="Allow background use">
        <button type="button" className="pill" onClick={() => void window.lyra.android?.openBatterySettings()}>
          Open
        </button>
      </Row>
      <Row label="Notification access" hint="Lets Lyra see what is playing">
        <button type="button" className="pill" onClick={() => void window.lyra.android?.openAccessSettings()}>
          Open
        </button>
      </Row>
    </section>
  )
}

export function SettingsPanel() {
  const android = document.documentElement.dataset.platform === 'android'
  const s = useSettings((x) => x.settings)
  const set = useSettings((x) => x.set)
  const status = usePlayer((x) => x.status)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.lyra.app.info().then((i) => setVersion(i.version))
  }, [])
  const up = <K extends keyof Settings>(k: K) => (v: Settings[K]) => set({ [k]: v } as Partial<Settings>)
  const tabs: Array<{ id: string; label: string }> = android
    ? [
        { id: 'phone', label: 'Phone' },
        { id: 'lyrics', label: 'Lyrics' },
        { id: 'look', label: 'Look' },
        { id: 'bg', label: 'Background' },
        { id: 'share', label: 'Share' },
        { id: 'about', label: 'About' }
      ]
    : [
        { id: 'general', label: 'General' },
        { id: 'lyrics', label: 'Lyrics' },
        { id: 'look', label: 'Look' },
        { id: 'bg', label: 'Background' },
        { id: 'share', label: 'Share' },
        { id: 'keys', label: 'Shortcuts' },
        { id: 'about', label: 'About' }
      ]
  const [tab, setTabState] = useState<string>(() => {
    const saved = sessionStorage.getItem('lyra.settingsTab')
    return tabs.some((t) => t.id === saved) ? (saved as string) : tabs[0]!.id
  })
  const setTab = (id: string): void => {
    setTabState(id)
    sessionStorage.setItem('lyra.settingsTab', id)
  }
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const nextIndex =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (index + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length
    const next = tabs[nextIndex]!
    setTab(next.id)
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

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
      <nav className="stabs" role="tablist" aria-label="Settings sections">
        {tabs.map((t, index) => (
          <button
            key={t.id}
            id={`settings-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="settings-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'is-on' : ''}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>
      {android && tab === 'phone' && <PhoneSection />}

      {!android && tab === 'general' && (
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
      )}

      {!android && tab === 'look' && (
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
      )}

      {tab === 'lyrics' && (
      <section>
        <h4>Lyrics</h4>
        <Row label="Romanized lyrics" info="Shows a Roman-letter reading below Hindi (Devanagari) and Punjabi (Gurmukhi) lyrics. This is transliteration, not translation." hint="Off by default">
          <Toggle label="Romanized lyrics" checked={s.romanizeLyrics} onChange={up('romanizeLyrics')} />
        </Row>
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
        <Row label="Fullscreen layout" hint="When a video plays behind the lyrics">
          <Segmented
            label="Fullscreen layout"
            value={s.fullLayout}
            onChange={up('fullLayout')}
            options={[
              { v: 'cinema', label: 'Cinema' },
              { v: 'split', label: 'Split' },
              { v: 'poster', label: 'Poster' }
            ]}
          />
        </Row>
        <Row
          label="Word by word"
          info="Highlights each word as it is sung. Free lyrics only have one time per line, so Lyra estimates the word timing from syllables and pauses: close, but not perfect. If a source has real word timing, that is used instead."
          hint="Estimated timing"
        >
          <Toggle label="Word by word" checked={s.wordByWord} onChange={up('wordByWord')} />
        </Row>
        <Row label="Default sync offset" hint="Every song. Fine-tune under the lyrics">
          <Slider label="Sync offset" value={s.lyricOffsetMs} min={-3000} max={3000} step={50} onChange={up('lyricOffsetMs')} format={(v) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(2)}s`} />
        </Row>
      </section>
      )}

      {tab === 'look' && (
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
      )}

      {tab === 'bg' && <BackgroundSection />}

      {tab === 'share' && (
      <section>
        <h4>Rooms: listen together</h4>
        <RoomHub />
      </section>
      )}

      {!android && tab === 'share' && (
      <section>
        <h4>Nearby screens (TV mode)</h4>
        <Row label="Show lyrics on other screens" hint="Same Wi-Fi, no internet needed: scan the QR code on a phone, tablet, laptop or TV browser to get big synced lyrics. Off by default">
          <Toggle label="TV and party mode" checked={s.lanViewer} onChange={up('lanViewer')} />
        </Row>
        {s.lanViewer && (
          <Row label="Stream sound too (Jam nearby)" hint="Lets devices on your Wi-Fi press Listen and hear this PC's sound with the lyrics. It sends everything this PC plays, only over your local network, and only while someone is listening. For you and the people in your home">
            <Toggle label="Stream sound" checked={s.lanAudio} onChange={up('lanAudio')} />
          </Row>
        )}
        {s.lanViewer && <TvLink />}
      </section>
      )}

      {!android && tab === 'general' && (
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
      )}

      {!android && tab === 'keys' && (
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
      )}

      {tab === 'about' && (
      <>
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
      </>
      )}
      </div>
    </div>
  )
}
