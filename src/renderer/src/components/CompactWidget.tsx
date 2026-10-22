import { AnimatePresence, motion } from 'framer-motion'
import { useLyricPreview, usePlayerView } from '@/hooks/usePlayerView'
import { useWindowDrag } from '@/hooks/useWindowDrag'
import { joinArtists } from '@/lib/format'
import { usePlayer } from '@/store/player'
import { requestMode } from '@/store/ui'
import { Artwork } from './Artwork'
import { IconButton, Transport } from './Controls'
import { ProgressBar } from './ProgressBar'
import { OfflineBanner, WidgetStatus } from './StateScreens'

export function CompactWidget({ minimal }: { minimal: boolean }) {
  const view = usePlayerView()
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const drag = useWindowDrag(() => requestMode('mini'))

  return (
    <div className={`widget ${minimal ? 'widget--minimal' : 'widget--compact'}`} {...drag} role="group" aria-label="Player widget">
      {view === 'playing' && track ? (
        minimal ? <MinimalBody /> : <CompactBody />
      ) : view === 'loading' || view === 'connect' || view === 'offline' || view === 'idle' || view === 'ad' ? (
        <WidgetStatus view={view} />
      ) : null}

      <div className="widget__actions" data-nodrag>
        {track && (
          <IconButton icon="external" label="Open in Spotify" size={14} onClick={() => void window.lyra.player.openInSpotify(track)} />
        )}
        <IconButton icon="expand" label="Expand player" size={14} onClick={() => requestMode('mini')} />
        <IconButton icon="minus" label="Minimize" size={14} onClick={() => window.lyra.window.minimize()} />
        <IconButton icon="close" label="Quit Lyra" size={14} onClick={() => window.lyra.window.quit()} />
      </div>

      {view === 'playing' && (
        <div className="widget__bar">
          <ProgressBar variant="thin" />
        </div>
      )}
      {!minimal && view === 'playing' && <OfflineBanner />}
    </div>
  )
}

function LyricLinePreview() {
  const p = useLyricPreview()
  const playing = usePlayer((s) => !!s.snapshot?.isPlaying)
  return (
    <div className="preview" aria-live="off">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={p.kind + p.text}
          className={`preview__text preview__text--${p.kind}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {p.kind === 'loading' ? <i className="shimmer" /> : p.kind === 'gap' ? '♪' : p.text}
        </motion.span>
      </AnimatePresence>
      {p.synced && (
        <span className={`syncdot ${playing ? 'is-live' : ''}`} title={playing ? 'Lyrics synchronized' : 'Lyrics synchronized (paused)'}>
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  )
}

function CompactBody() {
  const track = usePlayer((s) => s.snapshot!.track!)
  return (
    <>
      <Artwork url={track.artworkUrl} size={112} radius={12} />
      <div className="widget__meta">
        <div className="widget__title" title={track.title}>
          {track.title}
        </div>
        <div className="widget__artist" title={joinArtists(track.artists)}>
          {joinArtists(track.artists)}
        </div>
        <LyricLinePreview />
        <div className="widget__transport" data-nodrag>
          <Transport size="sm" />
        </div>
      </div>
    </>
  )
}

function MinimalBody() {
  const track = usePlayer((s) => s.snapshot!.track!)
  const p = useLyricPreview()
  return (
    <>
      <Artwork url={track.artworkUrl} size={40} radius={8} />
      <div className="widget__meta widget__meta--min">
        <div className="widget__title">{track.title}</div>
        <div className="widget__artist">{p.kind === 'line' ? p.text : joinArtists(track.artists)}</div>
      </div>
      <div data-nodrag>
        <Transport size="sm" />
      </div>
    </>
  )
}
