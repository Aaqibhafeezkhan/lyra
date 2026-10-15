import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { SavedMoment } from '@shared/types'
import { usePlayer } from '@/store/player'
import { useUi, type Panel } from '@/store/ui'
import { Artwork } from './Artwork'
import { IconButton } from './Controls'
import { Icon } from './Icon'
import { LyricsMatchPanel } from './LyricsMatchPanel'
import { SettingsPanel } from './SettingsPanel'

const TITLES: Record<Exclude<Panel, 'none'>, string> = { queue: 'Queue', moments: 'Moments', settings: 'Settings', lyrics: 'Lyrics match' }

export function SidePanel() {
  const panel = useUi((s) => s.panel)
  const setPanel = useUi((s) => s.setPanel)

  return (
    <AnimatePresence>
      {panel !== 'none' && (
        <>
          <motion.div
            key="scrim"
            className="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setPanel('none')}
          />
          <motion.aside
            key="panel"
            className="sidepanel"
            role="dialog"
            aria-label={TITLES[panel]}
            initial={{ x: '100%', opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          >
            <header className="sidepanel__head">
              <h3>{TITLES[panel]}</h3>
              <IconButton icon="close" label="Close panel" size={16} onClick={() => setPanel('none')} />
            </header>
            <div className="sidepanel__body">
              {panel === 'queue' && <QueuePanel />}
              {panel === 'moments' && <MomentsPanel />}
              {panel === 'settings' && <SettingsPanel />}
              {panel === 'lyrics' && <LyricsMatchPanel />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function QueuePanel() {
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const queue = usePlayer((s) => s.queue)
  const recent = usePlayer((s) => s.recent)
  const refreshQueue = usePlayer((s) => s.refreshQueue)
  const refreshRecent = usePlayer((s) => s.refreshRecent)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void Promise.all([refreshQueue(), refreshRecent()]).then(() => setLoaded(true))
  }, [refreshQueue, refreshRecent, track?.id])

  return (
    <div className="list">
      {track && (
        <>
          <h4>Now playing</h4>
          <div className="item item--now">
            <Artwork url={track.artworkUrl} size={44} radius={8} />
            <div>
              <b>{track.title}</b>
              <span>{track.artists.join(', ')}</span>
            </div>
          </div>
        </>
      )}
      <h4>Next up</h4>
      {!loaded ? (
        <p className="list__empty">Loading…</p>
      ) : queue === null ? (
        <p className="list__empty">The queue isn’t available from Spotify right now.</p>
      ) : queue.length === 0 ? (
        <p className="list__empty">Nothing queued after this track.</p>
      ) : (
        queue.map((q, i) => (
          <div key={`${q.id}-${i}`} className="item">
            <Artwork url={q.artworkUrl} size={40} radius={7} />
            <div>
              <b>{q.title}</b>
              <span>{q.artists.join(', ')}</span>
            </div>
          </div>
        ))
      )}
      {recent && recent.length > 0 && (
        <>
          <h4>Recently played</h4>
          {recent.slice(0, 8).map((q, i) => (
            <div key={`${q.id}-r${i}`} className="item item--dim">
              <Artwork url={q.artworkUrl} size={36} radius={6} />
              <div>
                <b>{q.title}</b>
                <span>{q.artists.join(', ')}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function MomentsPanel() {
  const [items, setItems] = useState<SavedMoment[] | null>(null)
  const toast = useUi((s) => s.toast)
  useEffect(() => {
    void window.lyra.moments.list().then(setItems)
  }, [])

  if (items === null) return <p className="list__empty">Loading…</p>
  if (items.length === 0)
    return (
      <div className="list__blank">
        <Icon name="bookmark" size={22} />
        <b>No saved moments yet</b>
        <p>Hover a lyric line and tap the bookmark to keep it here.</p>
      </div>
    )

  return (
    <div className="list">
      {items.map((m) => (
        <article key={m.id} className="moment">
          <blockquote>{m.text}</blockquote>
          <footer>
            <Artwork url={m.artworkUrl} size={28} radius={6} />
            <span>
              {m.title} · {m.artist}
            </span>
            <IconButton
              icon="copy"
              label="Copy line"
              size={14}
              onClick={() => void window.lyra.app.copy(m.text).then(() => toast('Copied'))}
            />
            <IconButton icon="trash" label="Remove moment" size={14} onClick={() => void window.lyra.moments.remove(m.id).then(setItems)} />
          </footer>
        </article>
      ))}
    </div>
  )
}
