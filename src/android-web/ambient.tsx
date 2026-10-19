import '@fontsource-variable/inter'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useActiveLine } from '@/hooks/useLyricsSync'
import { useLyrics } from '@/store/lyrics'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import './ambient.css'

/**
 * Ambient lyrics: black screen, one dim line of lyrics, a faint clock. It drifts a little every minute so an OLED
 * panel never keeps the same pixels lit. Used by the "Ambient screen" and by the Android screen saver.
 */
function useClock(): string {
  const fmt = (): string => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const [t, setT] = useState(fmt)
  useEffect(() => {
    const id = setInterval(() => setT(fmt()), 15_000)
    return () => clearInterval(id)
  }, [])
  return t
}

function Ambient() {
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const playing = usePlayer((s) => !!s.snapshot?.isPlaying)
  const st = useLyrics((s) => s.state)
  const lines = st.phase === 'ready' && st.result.status === 'synced' ? st.result.lines : []
  const idx = useActiveLine(lines, lines.length > 0)
  const cur = lines[idx]?.text ?? ''
  const next = lines[idx + 1]?.text ?? ''
  const clock = useClock()
  const [drift, setDrift] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const id = setInterval(() => setDrift({ x: Math.round((Math.random() - 0.5) * 56), y: Math.round((Math.random() - 0.5) * 80) }), 45_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="amb" style={{ transform: `translate(${drift.x}px, ${drift.y}px)` }}>
      <div className="amb__clock">{clock}</div>
      <div className="amb__lyrics">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={`${track?.id}:${idx}`} className="amb__cur" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 0.66, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
            {track ? cur || (lines.length ? '♪' : '') : ''}
          </motion.p>
        </AnimatePresence>
        <p className="amb__next">{next}</p>
      </div>
      <div className="amb__meta">{track ? `${track.title}${track.artists.length ? ` · ${track.artists.join(', ')}` : ''}${playing ? '' : ' · paused'}` : 'Nothing playing'}</div>
    </div>
  )
}

void (async () => {
  await useSettings.getState().init()
  await usePlayer.getState().init()
  useLyrics.getState().init()
  createRoot(document.getElementById('root')!).render(<Ambient />)
})()
