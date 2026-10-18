import { useEffect, useRef, useState } from 'react'
import type { YoutubeVideo } from '@shared/types'
import { useBackgroundVersion } from '@/hooks/useBackground'
import { usePlayer } from '@/store/player'
import { IconButton } from './Controls'

/** "Wrong video?" — pick another YouTube video for this song (only shown while a YouTube video is playing behind the lyrics). */
export function VideoPicker() {
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const bump = useBackgroundVersion((s) => s.bump)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<YoutubeVideo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpen(false)
    setItems(null)
  }, [track?.id])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  if (!track) return null

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next && !items) {
      setError(null)
      void window.lyra.background
        .youtubeCandidates(track)
        .then((r) => {
          setItems(r.items)
          if (r.error) setError(r.error)
        })
        .catch(() => setError('Couldn’t load other videos.'))
    }
  }
  const choose = (id: string | null): void => {
    void window.lyra.background.youtubeChoose(track.id, id).then(() => {
      setOpen(false)
      bump()
    })
  }

  return (
    <div className="vpick" ref={box}>
      <IconButton icon="refresh" label="Wrong video? Pick another" active={open} onClick={toggle} />
      {open && (
        <div className="vpick__pop" role="menu">
          <strong>Pick the right video</strong>
          {!items && !error && <small>Loading…</small>}
          {error && <small>{error}</small>}
          {items?.length === 0 && !error && <small>No other embeddable videos found.</small>}
          {items?.map((v) => (
            <button key={v.videoId} type="button" role="menuitem" onClick={() => choose(v.videoId)}>
              <span>{v.title}</span>
              <small>{v.channel}</small>
            </button>
          ))}
          <button type="button" className="vpick__auto" onClick={() => choose(null)}>
            Use Lyra’s automatic pick
          </button>
        </div>
      )}
    </div>
  )
}
