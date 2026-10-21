import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { BackgroundSpec, LyricLine, Track } from '@shared/types'
import { parseLrc } from '@shared/lrc'
import { estimateWords } from '@shared/wordTiming'
import { decodeAudio, exportFromFile } from '@/lib/studio/fileExport'
import { exportSmooth } from '@/lib/studio/twoPhase'
import { dimensions, exportVideo, type ExportOptions, type Fps, type FontChoice, type Highlight, type LayoutStyle, type Look, type Quality, type Ratio, type TextPosition } from '@/lib/studio/recorder'
import { autoChorus } from '@/lib/studio/sections'
import { StageSource } from '@/lib/studio/stage'
import { useLyrics } from '@/store/lyrics'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUi } from '@/store/ui'
import { StudioPreview } from './StudioPreview'

const RATIOS: Array<{ v: Ratio; label: string; hint: string }> = [
  { v: '9:16', label: '9:16', hint: 'Reels, Stories, Shorts, TikTok' },
  { v: '4:5', label: '4:5', hint: 'Instagram feed' },
  { v: '1:1', label: '1:1', hint: 'Square' },
  { v: '16:9', label: '16:9', hint: 'YouTube, long video' }
]
const QUALITIES: Array<{ v: Quality; label: string }> = [
  { v: '720p', label: 'Standard · 720p' },
  { v: '1080p', label: 'High · 1080p' },
  { v: '1440p', label: 'Ultra · 1440p' }
]

type Phase = { name: 'setup' } | { name: 'running'; stage: string; seconds: number; total: number } | { name: 'done'; path: string; droppedPct?: number; fps?: number; sourceQuality?: string; askedFps?: number; coverPath?: string | null } | { name: 'error'; message: string }
type Preset = 'chorus' | 'whole' | 'first30' | 'custom'
type Source = 'live' | 'file'

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const tag = (s: string): string => s.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 24)

interface OwnSong {
  audio: ArrayBuffer | null
  audioName: string
  durationMs: number
  lrc: string | null
  lrcName: string
  coverUrl: string | null
  title: string
  artist: string
}

/** Export a lyric video: of the song that is playing (recorded as it plays), or of an audio file you own (made quickly, in the background). */
export function StudioDialog({ onClose }: { onClose(): void }) {
  const track = usePlayer((s) => s.snapshot?.track)
  const lyrics = useLyrics((s) => s.state)
  const liveLines: LyricLine[] = useMemo(
    () => (track && lyrics.phase === 'ready' && lyrics.result.status === 'synced' && lyrics.result.trackId === track.id ? estimateWords(lyrics.result.lines, track.durationMs) : []),
    [lyrics, track]
  )
  const [source, setSource] = useState<Source>('live')
  const [own, setOwn] = useState<OwnSong>({ audio: null, audioName: '', durationMs: 0, lrc: null, lrcName: '', coverUrl: null, title: '', artist: '' })
  const [ratio, setRatio] = useState<Ratio>('9:16')
  const [quality, setQuality] = useState<Quality>('1080p')
  // a PC that dropped frames last time starts at 30 fps
  const [fps, setFps] = useState<Fps>(() => (localStorage.getItem('lyra.studio.slowPc') ? 30 : 60))
  const [look, setLook] = useState<Look>({ style: 'scroll', font: 'sans', highlight: 'white', position: 'middle', romanize: useSettings.getState().settings.romanizeLyrics })
  const [showSong, setShowSong] = useState(true)
  // smooth: record the song first, draw the video afterwards (never stutters, takes longer); instant: draw while it plays
  const [method, setMethod] = useState<'smooth' | 'instant'>(() => (localStorage.getItem('lyra.studio.method') === 'instant' ? 'instant' : 'smooth'))
  const [bg, setBg] = useState<'auto' | 'cover' | 'file'>('auto')
  const [file, setFile] = useState<{ url: string; kind: 'video' | 'image'; name: string } | null>(null)
  const [spec, setSpec] = useState<BackgroundSpec | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const [preset, setPreset] = useState<Preset>('chorus')
  const [range, setRange] = useState<{ startMs: number; endMs: number }>({ startMs: 0, endMs: 30_000 })
  const abort = useRef<AbortController | null>(null)
  const [previewStage, setPreviewStage] = useState<StageSource | null>(null)
  // which video plays behind the lyrics, and a way to swap it before recording
  const [pickOpen, setPickOpen] = useState(false)
  /** the tallest picture YouTube offers for the chosen video (0 = not known yet) */
  const [bestHeight, setBestHeight] = useState(0)
  const [cands, setCands] = useState<Array<{ videoId: string; title: string; channel: string; durationSec: number | null }> | null>(null)
  const chooseVideo = async (videoId: string): Promise<void> => {
    if (!track) return
    await window.lyra.background.youtubeChoose(track.id, videoId)
    const r = await window.lyra.background.resolve(track)
    setSpec(r.spec)
    setPickOpen(false)
  }

  useEffect(() => {
    if (!track) return
    void window.lyra.background.resolve(track).then((r) => setSpec(r.spec)).catch(() => setSpec(null))
  }, [track])
  useEffect(() => () => abort.current?.abort(), [])

  // a YouTube background plays in a hidden window, small, just for the preview (stopped as soon as you export or leave)
  const ytId = bg === 'auto' && source === 'live' && spec?.kind === 'youtube' ? spec.videoId : null
  const ytCrop = spec?.kind === 'youtube' ? spec.crop : null
  const startSecRef = useRef(0)
  startSecRef.current = range.startMs / 1000
  useEffect(() => {
    if (!ytId || phase.name !== 'setup') return
    let gone = false
    const s = new StageSource(ytCrop)
    void window.lyra.studio.stageStart({ videoId: ytId, width: 640, height: 360, fps: 8, startSec: startSecRef.current }).then((r) => {
      if (!gone && r.ok) {
        setPreviewStage(s)
        setBestHeight(r.bestHeight ?? 0)
      }
    })
    return () => {
      gone = true
      setPreviewStage(null)
      s.close()
      void window.lyra.studio.stageStop()
    }
  }, [ytId, ytCrop, phase.name])
  useEffect(() => {
    if (!previewStage) return
    const id = setTimeout(() => void window.lyra.studio.stageSeek(range.startMs / 1000), 350)
    return () => clearTimeout(id)
  }, [previewStage, range.startMs])

  // what the video is about: the playing song, or the file you picked
  const ownLines: LyricLine[] = useMemo(() => {
    if (!own.lrc) return []
    const parsed = own.lrcName.toLowerCase().endsWith('.lrc') ? parseLrc(own.lrc) : []
    if (parsed.length) return estimateWords(parsed, own.durationMs)
    const rows = own.lrc.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const span = Math.max(1000, own.durationMs - 3000)
    return estimateWords(
      rows.map((text, i) => ({ timeMs: 1000 + Math.round((i * span) / Math.max(1, rows.length)), text })),
      own.durationMs
    )
  }, [own.lrc, own.lrcName, own.durationMs])
  const subjectTrack: Track | null =
    source === 'live'
      ? (track ?? null)
      : own.audio
        ? { id: 'file', uri: '', title: own.title || own.audioName, artists: own.artist ? [own.artist] : [], album: '', releaseYear: null, durationMs: own.durationMs, artworkUrl: own.coverUrl, explicit: false, webUrl: null }
        : null
  const lines = source === 'live' ? liveLines : ownLines
  const durationMs = subjectTrack?.durationMs ?? 0

  // keep the chosen part in step with the preset (and with the lyrics once they load)
  useEffect(() => {
    if (!durationMs || preset === 'custom') return
    if (preset === 'whole') setRange({ startMs: 0, endMs: durationMs })
    else if (preset === 'first30') setRange({ startMs: 0, endMs: Math.min(durationMs, 30_000) })
    else setRange(autoChorus(lines, durationMs))
  }, [preset, lines, durationMs])

  const pickAudio = async (f: File): Promise<void> => {
    const buf = await f.arrayBuffer()
    try {
      const decoded = await decodeAudio(buf)
      const base = f.name.replace(/\.[^.]+$/, '')
      setOwn((o) => ({ ...o, audio: buf, audioName: f.name, durationMs: Math.round(decoded.duration * 1000), title: o.title || base }))
      setPreset('chorus')
    } catch {
      useUi.getState().toast('Couldn’t read that audio file', 'error')
    }
  }

  const { w, h } = dimensions(ratio, quality)
  const partMs = Math.max(0, range.endMs - range.startMs)
  const autoUsable = source === 'live' && (spec?.kind === 'preview' || spec?.kind === 'media' || spec?.kind === 'youtube')
  const approxMb = Math.round(((quality === '720p' ? 5 : quality === '1080p' ? 9 : 16) * (fps === 60 ? 1.4 : 1) * (partMs / 1000 + 3)) / 8)
  const media: { url: string; kind: 'video' | 'image' } | null =
    bg === 'file' && file
      ? { url: file.url, kind: file.kind }
      : bg === 'auto' && source === 'live' && spec?.kind === 'media'
        ? { url: spec.url, kind: spec.media }
        : bg === 'auto' && source === 'live' && spec?.kind === 'preview'
          ? { url: spec.url, kind: 'video' }
          : null

  const start = async (): Promise<void> => {
    const ctl = new AbortController()
    abort.current = ctl
    setPhase({ name: 'running', stage: 'Getting ready…', seconds: 0, total: partMs / 1000 })
    const onProgress = (p: { stage: string; seconds: number; total: number }): void =>
      setPhase({ name: 'running', stage: p.stage === 'recording' ? (source === 'live' ? (method === 'smooth' ? 'Recording the song' : 'Recording') : 'Making the video') : p.stage === 'rendering' ? 'Rendering the video' : p.stage === 'finishing' ? 'Finishing the file…' : 'Getting ready…', seconds: p.seconds, total: p.total })
    try {
      if (source === 'live') {
        const opts: ExportOptions = {
          look,
          ratio,
          quality,
          fps,
          startMs: range.startMs,
          endMs: range.endMs,
          showSong,
          mediaUrl: bg === 'file' ? (file?.url ?? null) : bg === 'auto' && spec?.kind === 'media' ? spec.url : null,
          mediaKind: bg === 'file' ? (file?.kind ?? null) : bg === 'auto' && spec?.kind === 'media' ? spec.media : null,
          clipUrl: bg === 'auto' && spec?.kind === 'preview' ? spec.url : null,
          youtube: bg === 'auto' && spec?.kind === 'youtube' ? { videoId: spec.videoId, crop: spec.crop } : null
        }
        const r = await (method === 'smooth' ? exportSmooth(opts, onProgress, ctl.signal) : exportVideo(opts, onProgress, ctl.signal))
        if (r.droppedPct >= 8) localStorage.setItem('lyra.studio.slowPc', '1')
        setPhase({ name: 'done', path: r.path, droppedPct: r.droppedPct, fps: r.fps, sourceQuality: r.sourceQuality, askedFps: fps, coverPath: r.coverPath })
      } else {
        const r = await exportFromFile(
          {
            audio: own.audio!,
            title: own.title || own.audioName,
            artist: own.artist,
            lines: ownLines,
            coverUrl: own.coverUrl,
            ratio,
            quality,
            fps,
            look,
            showSong,
            startMs: range.startMs,
            endMs: range.endMs,
            mediaUrl: bg === 'file' ? (file?.url ?? null) : null,
            mediaKind: bg === 'file' ? (file?.kind ?? null) : null
          },
          onProgress,
          ctl.signal
        )
        setPhase({ name: 'done', path: r.path })
      }
    } catch (e) {
      const m = (e as Error).message
      setPhase(m === 'cancelled' ? { name: 'setup' } : { name: 'error', message: m })
    }
  }

  const setStart = (v: number): void => {
    setPreset('custom')
    setRange((r) => ({ startMs: Math.min(v, r.endMs - 3000), endMs: r.endMs }))
  }
  const setEnd = (v: number): void => {
    setPreset('custom')
    setRange((r) => ({ startMs: r.startMs, endMs: Math.max(v, r.startMs + 3000) }))
  }
  const pickStyle = (style: LayoutStyle): void => setLook((l) => ({ ...l, style, position: style === 'subtitle' ? 'lower' : 'middle' }))
  const caption = subjectTrack
    ? `${subjectTrack.title}${subjectTrack.artists.length ? ` · ${subjectTrack.artists.join(', ')}` : ''} 🎶\n\nMade with Lyra ♥ Free lyric videos: https://lyra-website-rho.vercel.app\n\n#lyrics #lyricvideo ${subjectTrack.artists[0] ? `#${tag(subjectTrack.artists[0])} ` : ''}#lyra`
    : ''
  const seg = <T extends string>(label: string, value: T, options: Array<{ v: T; label: string }>, onChange: (v: T) => void): ReactElement => (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" className={value === o.v ? 'is-on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )

  if (!track && source === 'live') return null
  const ready = source === 'live' || (own.audio && own.durationMs > 0)

  return (
    <div className="sharecard" role="dialog" aria-label="Export a lyric video" data-nodrag>
      <div className="sharecard__box studio">
        <header>
          <b>Export lyric video</b>
          <button type="button" className="ibtn" aria-label="Close" onClick={() => (phase.name === 'running' ? abort.current?.abort() : onClose())}>
            ✕
          </button>
        </header>

        {phase.name === 'setup' && (
          <>
            {seg<Source>('Source', source, [{ v: 'live', label: 'The song playing now' }, { v: 'file', label: 'My own audio file' }], (v) => { setSource(v); setPreset('chorus') })}

            {source === 'live' && track && (
              <p className="studio__song">
                <b>{track.title}</b> · {track.artists.join(', ')} · {fmt(durationMs / 1000)}
              </p>
            )}

            {source === 'file' && (
              <div className="studio__group">
                <span>Your song</span>
                <label className="pill">
                  {own.audio ? `Audio: ${own.audioName}` : 'Choose an audio file…'}
                  <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && void pickAudio(e.target.files[0])} />
                </label>
                <label className="pill">
                  {own.lrc ? `Lyrics: ${own.lrcName}` : 'Choose lyrics (.lrc with timing, or plain .txt)…'}
                  <input
                    type="file"
                    accept=".lrc,.txt,text/plain"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const text = await f.text()
                      setOwn((o) => ({ ...o, lrc: text, lrcName: f.name }))
                    }}
                  />
                </label>
                <label className="pill">
                  {own.coverUrl ? 'Cover picked' : 'Choose a cover image (optional)…'}
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && setOwn((o) => ({ ...o, coverUrl: URL.createObjectURL(e.target.files![0]!) }))} />
                </label>
                <div className="joinrow">
                  <input value={own.title} onChange={(e) => setOwn((o) => ({ ...o, title: e.target.value }))} placeholder="Song title" aria-label="Song title" />
                  <input value={own.artist} onChange={(e) => setOwn((o) => ({ ...o, artist: e.target.value }))} placeholder="Artist" aria-label="Artist" />
                </div>
                {own.lrc && !own.lrcName.toLowerCase().endsWith('.lrc') && <small>Plain text: the lines are spread evenly over the song. Use an .lrc file for exact timing.</small>}
              </div>
            )}

            {ready && subjectTrack && (
              <>
                <div className="studio__preview-wrap">
                  <StudioPreview track={subjectTrack} lines={lines} ratio={ratio} look={look} showSong={showSong} media={media} stage={previewStage} startMs={range.startMs} endMs={range.endMs} />
                </div>

                <div className="studio__group">
                  <span>Part of the song</span>
                  {seg<Preset>('Part of the song', preset, [{ v: 'chorus', label: 'Chorus' }, { v: 'first30', label: 'First 30 s' }, { v: 'whole', label: 'Whole song' }, { v: 'custom', label: 'Custom' }], setPreset)}
                  <div className="studio__range">
                    <label>
                      <small>From {fmt(range.startMs / 1000)}</small>
                      <input type="range" min={0} max={durationMs} step={500} value={range.startMs} onChange={(e) => setStart(Number(e.target.value))} aria-label="Start" />
                    </label>
                    <label>
                      <small>To {fmt(range.endMs / 1000)}</small>
                      <input type="range" min={0} max={durationMs} step={500} value={range.endMs} onChange={(e) => setEnd(Number(e.target.value))} aria-label="End" />
                    </label>
                  </div>
                  <small>
                    {fmt(partMs / 1000)} long{preset === 'chorus' && lines.length === 0 ? ' · no synced lyrics yet, using the first 30 s' : ''}
                  </small>
                </div>

                <div className="studio__group">
                  <span>Shape</span>
                  <div className="studio__choices">
                    {RATIOS.map((r) => (
                      <button key={r.v} type="button" className={ratio === r.v ? 'is-on' : ''} onClick={() => setRatio(r.v)}>
                        <i style={{ aspectRatio: r.v.replace(':', ' / ') }} />
                        <b>{r.label}</b>
                        <small>{r.hint}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="studio__group">
                  <span>Quality</span>
                  {seg<Quality>('Quality', quality, QUALITIES, setQuality)}
                  {source === 'live' && (
                    <>
                      <span>How to make it</span>
                      {seg<string>('How to make it', method, [{ v: 'smooth', label: 'Smooth: record, then render' }, { v: 'instant', label: 'Instant: while it plays' }], (v) => { const m = v === 'instant' ? 'instant' : 'smooth'; setMethod(m); localStorage.setItem('lyra.studio.method', m) })}
                      <small>{method === 'smooth' ? 'The song plays once, then Lyra draws the video at its own pace: never stutters, even on a busy PC. Takes a little longer.' : 'Draws while the song plays: ready the moment it ends, but a busy PC can make it choppy.'}</small>
                    </>
                  )}
                  <span>Smoothness</span>
                  {seg<string>('Smoothness', String(fps), [{ v: '60', label: '60 fps · smooth' }, { v: '30', label: '30 fps · smaller file' }], (v) => setFps(v === '30' ? 30 : 60))}
                  <small>
                    {w}×{h} · {fps} fps · about {approxMb} MB
                  </small>
                </div>

                <div className="studio__group">
                  <span>Lyrics look</span>
                  {seg<LayoutStyle>('Layout', look.style, [{ v: 'scroll', label: 'Scrolling' }, { v: 'focus', label: 'One big line' }, { v: 'subtitle', label: 'Subtitle' }], pickStyle)}
                  {seg<FontChoice>('Font', look.font, [{ v: 'sans', label: 'Sans' }, { v: 'serif', label: 'Serif' }, { v: 'rounded', label: 'Round' }, { v: 'mono', label: 'Mono' }], (font) => setLook((l) => ({ ...l, font })))}
                  {seg<Highlight>('Highlight colour', look.highlight, [{ v: 'white', label: 'White' }, { v: 'accent', label: 'Cover colour' }, { v: 'gold', label: 'Gold' }], (highlight) => setLook((l) => ({ ...l, highlight })))}
                  {lines.some((l) => /[\u0900-\u097F\u0A00-\u0A7F]/.test(l.text)) && (
                    <>
                      <span>Roman letters</span>
                      {seg<string>('Roman letters', look.romanize ? 'on' : 'off', [{ v: 'off', label: 'Original only' }, { v: 'on', label: 'Add Roman letters' }], (v) => setLook((l) => ({ ...l, romanize: v === 'on' })))}
                    </>
                  )}
                  {seg<TextPosition>('Text position', look.position, [{ v: 'upper', label: 'Upper' }, { v: 'middle', label: 'Middle' }, { v: 'lower', label: 'Lower' }], (position) => setLook((l) => ({ ...l, position })))}
                </div>

                <div className="studio__group">
                  <span>Background</span>
                  {seg<'auto' | 'cover' | 'file'>('Background', bg, source === 'live' ? [{ v: 'auto', label: 'Current video' }, { v: 'cover', label: 'Cover colours' }, { v: 'file', label: 'My file' }] : [{ v: 'cover', label: 'Cover colours' }, { v: 'file', label: 'My video or photo' }], setBg)}
                  {source === 'live' && bg === 'auto' && !autoUsable && <small>This song’s video can’t be exported yet, so the cover’s colours are used.</small>}
                  {source === 'live' && bg === 'auto' && spec?.kind === 'youtube' && (
                    <>
                      <small>
                        Video: {spec.title} · {spec.channel}
                      </small>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => {
                          setPickOpen((o) => !o)
                          if (!cands && track) void window.lyra.background.youtubeCandidates(track).then((r) => setCands(r.items))
                        }}
                      >
                        {pickOpen ? 'Close the list' : 'Wrong video? Choose another'}
                      </button>
                      {bestHeight > 0 && bestHeight < 720 && (
                        <small style={{ color: '#ffb36b' }}>This video is only {bestHeight}p on YouTube, so the picture will look soft. Another video or Cover colours will look sharper.</small>
                      )}
                      {pickOpen && (
                        <div className="studio__choices" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                          {(cands ?? []).slice(0, 8).map((c) => (
                            <button type="button" key={c.videoId} className={`pill ${c.videoId === spec.videoId ? 'pill--primary' : ''}`} onClick={() => void chooseVideo(c.videoId)}>
                              {c.title} · {c.channel}
                              {c.durationSec ? ` · ${fmt(c.durationSec)}` : ''}
                            </button>
                          ))}
                          {cands && cands.length === 0 && <small>No other videos found for this song.</small>}
                          {!cands && <small>Looking…</small>}
                        </div>
                      )}
                    </>
                  )}
                  {bg === 'file' && (
                    <label className="pill">
                      {file ? file.name : 'Choose a video or photo…'}
                      <input
                        type="file"
                        accept="video/*,image/*"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) setFile({ url: URL.createObjectURL(f), kind: f.type.startsWith('video') ? 'video' : 'image', name: f.name })
                        }}
                      />
                    </label>
                  )}
                </div>

                <label className="studio__check">
                  <input type="checkbox" checked={showSong} onChange={(e) => setShowSong(e.target.checked)} /> Show the song’s cover and title
                </label>

                <p className="hint">
                  {source === 'live'
                    ? `Lyra jumps to the start of the part and records it in real time, so ${fmt(partMs / 1000)} of video takes ${fmt(partMs / 1000)}. Keep Lyra open, don’t play other sounds, and leave the volume up.`
                    : 'Made straight from your file, faster than real time and silently, so you can keep working or listen to other songs.'}{' '}
                  A small “Made with Lyra ♥” badge sits at the bottom, and a short “Download Lyra” card closes the video.
                </p>
                <div className="sharecard__row sharecard__row--end">
                  <button type="button" className="pill pill--primary" onClick={() => void start()} disabled={bg === 'file' && !file}>
                    Export…
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {phase.name === 'running' && (
          <>
            <p className="studio__song">
              {phase.stage}
              {phase.stage !== 'Getting ready…' && phase.stage !== 'Finishing the file…' ? ` · ${fmt(phase.seconds)} / ${fmt(phase.total)}` : ''}
            </p>
            <div className="studio__bar">
              <b style={{ transform: `scaleX(${phase.total ? Math.min(1, phase.seconds / phase.total) : 0})` }} />
            </div>
            <p className="hint">{source === 'live' && phase.stage !== 'Rendering the video' ? 'Keep Lyra open and the song playing out loud. You can use other programs.' : 'You can keep using your PC. Lyra just needs to stay open.'}</p>
            <div className="sharecard__row sharecard__row--end">
              <button type="button" className="pill" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase.name === 'done' && (
          <>
            <p className="studio__song">
              <b>Saved.</b> {phase.path}
            </p>
            {phase.fps !== undefined && phase.askedFps !== undefined && phase.fps < phase.askedFps && (
              <p className="studio__song" style={{ color: '#ffb36b' }}>
                Recorded at {phase.fps} fps: this PC could not draw 60 frames a second smoothly, so Lyra chose a steady {phase.fps} instead.
              </p>
            )}
            {phase.coverPath && (
              <p className="studio__song">Cover picture saved next to the video: {phase.coverPath}</p>
            )}
            {phase.sourceQuality && (
              <p className="studio__song">
                Background video quality: {phase.sourceQuality.replace('x', '×')}
              </p>
            )}
            {(phase.droppedPct ?? 0) >= 8 && (
              <p className="studio__song" style={{ color: '#ffb36b' }}>
                This PC could not keep up: about {phase.droppedPct}% of the frames were skipped, so the video looks choppy. Close other programs (free memory), pick 30 fps and a lower quality, or use “My own audio file”, which is not recorded live and always comes out smooth.
              </p>
            )}
            <div className="studio__group">
              <span>Caption (ready to paste)</span>
              <textarea className="studio__caption" readOnly value={caption} rows={5} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <div className="sharecard__row sharecard__row--end">
              <button
                type="button"
                className="pill"
                onClick={() =>
                  void window.lyra.app.copy(caption).then((ok) => useUi.getState().toast(ok ? 'Caption copied' : 'Couldn’t copy', ok ? 'info' : 'error'))
                }
              >
                Copy caption
              </button>
              <button type="button" className="pill" onClick={() => void window.lyra.studio.reveal(phase.path)}>
                Show in folder
              </button>
              <button type="button" className="pill pill--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {phase.name === 'error' && (
          <>
            <p className="hint">Couldn’t finish: {phase.message}</p>
            <div className="sharecard__row sharecard__row--end">
              <button type="button" className="pill" onClick={() => setPhase({ name: 'setup' })}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
