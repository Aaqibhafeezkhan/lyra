import { useEffect, useRef, useState } from 'react'
import type { BackgroundSpec } from '@shared/types'
import { dimensions, exportVideo, type ExportOptions, type Quality, type Ratio } from '@/lib/studio/recorder'
import { usePlayer } from '@/store/player'

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

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Export the song that is playing as a finished lyric video: pick a shape and a quality, press Export. */
export function StudioDialog({ onClose }: { onClose(): void }) {
  const track = usePlayer((s) => s.snapshot?.track)
  const [ratio, setRatio] = useState<Ratio>('9:16')
  const [quality, setQuality] = useState<Quality>('1080p')
  const [whole, setWhole] = useState(true)
  const [showSong, setShowSong] = useState(true)
  const [bg, setBg] = useState<'auto' | 'cover' | 'file'>('auto')
  const [file, setFile] = useState<{ url: string; kind: 'video' | 'image'; name: string } | null>(null)
  const [spec, setSpec] = useState<BackgroundSpec | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!track) return
    void window.lyra.background.resolve(track).then((r) => setSpec(r.spec)).catch(() => setSpec(null))
  }, [track])
  useEffect(() => () => abort.current?.abort(), [])

  if (!track) return null
  const { w, h } = dimensions(ratio, quality)
  const secs = track.durationMs / 1000
  const autoUsable = spec?.kind === 'preview' || (spec?.kind === 'media' && spec.media === 'video') || (spec?.kind === 'media' && spec.media === 'image')
  const approxMb = Math.round(((quality === '720p' ? 5 : quality === '1080p' ? 9 : 16) * (whole ? secs : 30)) / 8)

  const start = async (): Promise<void> => {
    const opts: ExportOptions = {
      ratio,
      quality,
      maxSeconds: whole ? 0 : 30,
      showSong,
      mediaUrl: bg === 'file' ? (file?.url ?? null) : bg === 'auto' && spec?.kind === 'media' ? spec.url : null,
      mediaKind: bg === 'file' ? (file?.kind ?? null) : bg === 'auto' && spec?.kind === 'media' ? spec.media : null,
      clipUrl: bg === 'auto' && spec?.kind === 'preview' ? spec.url : null
    }
    const ctl = new AbortController()
    abort.current = ctl
    setPhase({ name: 'running', stage: 'Getting ready…', seconds: 0, total: whole ? secs : 30 })
    try {
      const r = await exportVideo(opts, (p) => setPhase({ name: 'running', stage: p.stage === 'recording' ? 'Recording' : p.stage === 'finishing' ? 'Finishing the file…' : 'Getting ready…', seconds: p.seconds, total: p.total }), ctl.signal)
      setPhase({ name: 'done', path: r.path, seconds: r.seconds })
    } catch (e) {
      const m = (e as Error).message
      setPhase(m === 'cancelled' ? { name: 'setup' } : { name: 'error', message: m })
    }
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
              <b>{track.title}</b> · {track.artists.join(', ')} · {fmt(secs)}
            </p>

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
              <span>Length</span>
              <div className="seg" role="group" aria-label="Length">
                <button type="button" className={whole ? 'is-on' : ''} onClick={() => setWhole(true)}>
                  Whole song
                </button>
                <button type="button" className={!whole ? 'is-on' : ''} onClick={() => setWhole(false)}>
                  First 30 s (quick test)
                </button>
              </div>
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
              Lyra restarts the song and records it in real time, so a {whole ? fmt(secs) : '0:30'} video takes {whole ? fmt(secs) : '0:30'}. Keep Lyra open, don’t play other sounds, and leave the volume up. A small “Made with Lyra ♥” badge sits at the bottom, and a short “Download Lyra” card closes the video.
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
