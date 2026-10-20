import { useEffect, useMemo, useRef, useState } from 'react'
import type { LyricLine } from '@shared/types'
import { cardDataUrl, drawCard } from '@/lib/shareCard'
import { usePlayer } from '@/store/player'
import { useUi } from '@/store/ui'

/** Pick up to three lines around the one you tapped, preview the card, then save, copy or share it. */
export function ShareCard({ lines, index, onClose }: { lines: LyricLine[]; index: number; onClose(): void }) {
  const track = usePlayer((s) => s.snapshot?.track)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [from, setFrom] = useState(index)
  const [count, setCount] = useState(1)
  const android = document.documentElement.dataset.platform === 'android'
  const text = useMemo(
    () =>
      lines
        .slice(from, from + count)
        .map((l) => l.text)
        .filter(Boolean),
    [lines, from, count]
  )

  useEffect(() => {
    if (!track || !canvas.current || text.length === 0) return
    const css = getComputedStyle(document.documentElement)
    void drawCard(canvas.current, {
      lines: text,
      title: track.title,
      artist: track.artists.join(', '),
      artworkUrl: track.artworkUrl,
      accent: css.getPropertyValue('--accent').trim() || '#d8d8d8',
      tint1: css.getPropertyValue('--tint1').trim() || '#1a1a1a',
      tint2: css.getPropertyValue('--tint2').trim() || '#101010'
    })
  }, [track, text])

  if (!track) return null
  const toast = useUi.getState().toast
  const name = `lyra-${track.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.png`
  const data = (): string | null => {
    try {
      return cardDataUrl(canvas.current!)
    } catch {
      toast('Couldn’t make the image (the cover blocks it). Try another song', 'error')
      return null
    }
  }
  const act = async (kind: 'save' | 'copy' | 'share'): Promise<void> => {
    const url = data()
    if (!url) return
    if (kind === 'copy') {
      toast((await window.lyra.app.copyImage(url)) ? 'Image copied. Paste it anywhere' : 'Couldn’t copy the image', 'info')
    } else {
      const r = await window.lyra.app.shareImage(url, name)
      if (r === 'saved') toast('Card saved')
      else if (r === 'failed') toast('Couldn’t save the card', 'error')
    }
  }

  return (
    <div className="sharecard" role="dialog" aria-label="Share a lyric card" data-nodrag>
      <div className="sharecard__box">
        <header>
          <b>Share a lyric card</b>
          <button type="button" className="ibtn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <canvas ref={canvas} className="sharecard__canvas" />
        <div className="sharecard__row">
          <span>Lines</span>
          <div className="seg" role="group" aria-label="Number of lines">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={count === n ? 'is-on' : ''} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
          <button type="button" className="pill" disabled={from <= 0} onClick={() => setFrom((f) => Math.max(0, f - 1))}>
            ↑ Earlier
          </button>
          <button type="button" className="pill" disabled={from + count >= lines.length} onClick={() => setFrom((f) => f + 1)}>
            ↓ Later
          </button>
        </div>
        <div className="sharecard__row sharecard__row--end">
          {!android && (
            <button type="button" className="pill" onClick={() => void act('copy')}>
              Copy image
            </button>
          )}
          <button type="button" className="pill pill--primary" onClick={() => void act('share')}>
            {android ? 'Share' : 'Save image'}
          </button>
        </div>
      </div>
    </div>
  )
}
