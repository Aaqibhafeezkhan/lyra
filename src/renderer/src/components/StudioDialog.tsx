import { useEffect, useMemo, useRef, useState } from 'react'
import type { BackgroundSpec, LyricLine } from '@shared/types'
import { estimateWords } from '@shared/wordTiming'
import { dimensions, exportVideo, type ExportOptions, type Quality, type Ratio } from '@/lib/studio/recorder'
import { autoChorus } from '@/lib/studio/sections'
import { useLyrics } from '@/store/lyrics'
import { usePlayer } from '@/store/player'
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

type Phase = { name: 'setup' } | { name: 'running'; stage: string; seconds: number; total: number } | { name: 'done'; path: string; seconds: number } | { name: 'error'; message: string }
type Preset = 'chorus' | 'whole' | 'first30' | 'custom'

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Export the song that is playing as a finished lyric video: pick the part, the shape and the quality, check the preview, press Export. */
export function StudioDialog({ onClose }: { onClose(): void }) {
  const track = usePlayer((s) => s.snapshot?.track)
  const lyrics = useLyrics((s) => s.state)
  const lines: LyricLine[] = useMemo(
    () => (track && lyrics.phase === 'ready' && lyrics.result.status === 'synced' && lyrics.result.trackId === track.id ? estimateWords(lyrics.result.lines, track.durationMs) : []),
    [lyrics, track]
  )
  const [ratio, setRatio] = useState<Ratio>('9:16')
  const [quality, setQuality] = useState<Quality>('1080p')
  const [showSong, setShowSong] = useState(true)
  const [bg, setBg] = useState<'auto' | 'cover' | 'file'>('auto')
  const [file, setFile] = useState<{ url: string; kind: 'video' | 'image'; name: string } | null>(null)
  const [spec, setSpec] = useState<BackgroundSpec | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const [preset, setPreset] = useState<Preset>('chorus')
  const [range, setRange] = useState<{ startMs: number; endMs: number }>({ startMs: 0, endMs: 30_000 })
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!track) return
    void window.lyra.background.resolve(track).then((r) => setSpec(r.spec)).catch(() => setSpec(null))
  }, [track])
  useEffect(() => () => abort.current?.abort(), [])

  const durationMs = track?.durationMs ?? 0
  // keep the chosen part in step with the preset (and with the lyrics once they load)
  useEffect(() => {
    if (!durationMs || preset === 'custom') return
    if (preset === 'whole') setRange({ startMs: 0, endMs: durationMs })
    else if (preset === 'first30') setRange({ startMs: 0, endMs: Math.min(durationMs, 30_000) })
    else setRange(autoChorus(lines, durationMs))
  }, [preset, lines, durationMs])

  if (!track) return null
  const { w, h } = dimensions(ratio, quality)
  const partMs = Math.max(0, range.endMs - range.startMs)
  const autoUsable = spec?.kind === 'preview' || spec?.kind === 'media'
  const approxMb = Math.round(((quality === '720p' ? 5 : quality === '1080p' ? 9 : 16) * (partMs / 1000 + 3)) / 8)

  // what sits behind the lyrics, for both the preview and the export
  const media: { url: string; kind: 'video' | 'image' } | null =
    bg === 'file' && file
      ? { url: file.url, kind: file.kind }
      : bg === 'auto' && spec?.kind === 'media'
        ? { url: spec.url, kind: spec.media }
        : bg === 'auto' && spec?.kind === 'preview'
          ? { url: spec.url, kind: 'video' }
          : null

  const start = async (): Promise<void> => {
    const opts: ExportOptions = {
      ratio,
      quality,
      startMs: range.startMs,
      endMs: range.endMs,
      showSong,
      mediaUrl: bg === 'file' ? (file?.url ?? null) : bg === 'auto' && spec?.kind === 'media' ? spec.url : null,
      mediaKind: bg === 'file' ? (file?.kind ?? null) : bg === 'auto' && spec?.kind === 'media' ? spec.media : null,
      clipUrl: bg === 'auto' && spec?.kind === 'preview' ? spec.url : null
    }
    const ctl = new AbortController()
    abort.current = ctl
    setPhase({ name: 'running', stage: 'Getting ready…', seconds: 0, total: partMs / 1000 })
    try {
      const r = await exportVideo(opts, (p) => setPhase({ name: 'running', stage: p.stage === 'recording' ? 'Recording' : p.stage === 'finishing' ? 'Finishing the file…' : 'Getting ready…', seconds: p.seconds, total: p.total }), ctl.signal)
      setPhase({ name: 'done', path: r.path, seconds: r.seconds })
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
            <p className="studio__song">
              <b>{track.title}</b> · {track.artists.join(', ')} · {fmt(durationMs / 1000)}
            </p>

            <div className="studio__preview-wrap">
              <StudioPreview track={track} lines={lines} ratio={ratio} showSong={showSong} media={media} startMs={range.startMs} endMs={range.endMs} />
            </div>

            <div className="studio__group">
              <span>Part of the song</span>
              <div className="seg" role="group" aria-label="Part of the song">
                <button type="button" className={preset === 'chorus' ? 'is-on' : ''} onClick={() => setPreset('chorus')}>
                  Chorus
                </button>
                <button type="button" className={preset === 'first30' ? 'is-on' : ''} onClick={() => setPreset('first30')}>
                  First 30 s
                </button>
                <button type="button" className={preset === 'whole' ? 'is-on' : ''} onClick={() => setPreset('whole')}>
                  Whole song
                </button>
                <button type="button" className={preset === 'custom' ? 'is-on' : ''} onClick={() => setPreset('custom')}>
                  Custom
                </button>
              </div>
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
              <div className="seg" role="group" aria-label="Quality">
                {QUALITIES.map((q) => (
                  <button key={q.v} type="button" className={quality === q.v ? 'is-on' : ''} onClick={() => setQuality(q.v)}>
                    {q.label}
                  </button>
                ))}
              </div>
              <small>
                {w}×{h} · 30 fps · about {approxMb} MB
              </small>
            </div>

            <div className="studio__group">
              <span>Background</span>
              <div className="seg" role="group" aria-label="Background">
                <button type="button" className={bg === 'auto' ? 'is-on' : ''} onClick={() => setBg('auto')}>
                  Current video
                </button>
                <button type="button" className={bg === 'cover' ? 'is-on' : ''} onClick={() => setBg('cover')}>
                  Cover colours
                </button>
                <button type="button" className={bg === 'file' ? 'is-on' : ''} onClick={() => setBg('file')}>
                  My file
                </button>
              </div>
              {bg === 'auto' && !autoUsable && <small>This song’s video can’t be exported yet, so the cover’s colours are used.</small>}
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
              Lyra jumps to the start of the part and records it in real time, so {fmt(partMs / 1000)} of video takes {fmt(partMs / 1000)}. Keep Lyra open, don’t play other sounds, and leave the volume up. A small “Made with Lyra ♥” badge sits at the bottom, and a short “Download Lyra” card closes the video.
            </p>
            <div className="sharecard__row sharecard__row--end">
              <button type="button" className="pill pill--primary" onClick={() => void start()} disabled={bg === 'file' && !file}>
                Export…
              </button>
            </div>
          </>
        )}

        {phase.name === 'running' && (
          <>
            <p className="studio__song">
              {phase.stage}
              {phase.stage === 'Recording' ? ` · ${fmt(phase.seconds)} / ${fmt(phase.total)}` : ''}
            </p>
            <div className="studio__bar">
              <b style={{ transform: `scaleX(${phase.total ? Math.min(1, phase.seconds / phase.total) : 0})` }} />
            </div>
            <p className="hint">Keep Lyra open and your PC’s sound on. Don’t play other sounds until it is done.</p>
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
            <div className="sharecard__row sharecard__row--end">
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
