import { usePlayerView } from '@/hooks/usePlayerView'
import { useWindowDrag } from '@/hooks/useWindowDrag'
import { joinArtists } from '@/lib/format'
import { usePlayer } from '@/store/player'
import { requestMode, useUi } from '@/store/ui'
import { Artwork } from './Artwork'
import { IconButton, Transport, VolumeControl } from './Controls'
import { LyricsView } from './LyricsView'
import { ProgressBar } from './ProgressBar'
import { ConnectScreen, LoadingScreen, NoMusicScreen, OfflineBanner, OfflineScreen } from './StateScreens'

export function LikeButton({ size = 18 }: { size?: number }) {
  const liked = usePlayer((s) => s.liked)
  const toggle = usePlayer((s) => s.toggleLike)
  const status = usePlayer((s) => s.status)
  const unavailable = liked === null
  return (
    <IconButton
      icon="heart"
      label={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
      title={unavailable ? (status?.state === 'demo' ? 'Like' : 'Liking isn’t available for this item') : undefined}
      active={!!liked}
      filled={!!liked}
      disabled={unavailable}
      size={size}
      className="likebtn"
      onClick={() => void toggle()}
    />
  )
}

export function MiniPlayer() {
  const view = usePlayerView()
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const device = usePlayer((s) => s.snapshot?.device ?? null)
  const panel = useUi((s) => s.panel)
  const togglePanel = useUi((s) => s.togglePanel)
  const drag = useWindowDrag()

  return (
    <div className="mini">
      <header className="mini__head" {...drag}>
        <span className="mini__device" title={device ? `Playing on ${device.name}` : undefined}>
          {device ? device.name : 'Lyra'}
        </span>
        <div className="mini__tools" data-nodrag>
          <IconButton icon="queue" label="Queue" active={panel === 'queue'} size={16} onClick={() => togglePanel('queue')} />
          <IconButton icon="bookmark" label="Saved lyric moments" active={panel === 'moments'} size={16} onClick={() => togglePanel('moments')} />
          <IconButton icon="settings" label="Settings" active={panel === 'settings'} size={16} onClick={() => togglePanel('settings')} />
          <IconButton icon="fullscreen" label="Fullscreen lyrics" size={16} onClick={() => requestMode('full')} />
          <IconButton icon="collapse" label="Collapse to widget" size={16} onClick={() => requestMode('compact')} />
        </div>
      </header>

      {view === 'playing' && track ? (
        <>
          <OfflineBanner />
          <div className="mini__art" {...drag}>
            <Artwork url={track.artworkUrl} size="min(232px, 31vh)" radius={14} className="artwork--lift" />
          </div>
          <div className="mini__info">
            <div className="mini__text">
              <h1 title={track.title}>
                {track.title}
                {track.explicit && <span className="tag">E</span>}
              </h1>
              <p title={joinArtists(track.artists)}>{joinArtists(track.artists)}</p>
            </div>
            <div className="mini__info-actions" data-nodrag>
              <LikeButton />
            </div>
          </div>
          <div className="mini__progress" data-nodrag>
            <ProgressBar showTimes />
          </div>
          <div className="mini__transport" data-nodrag>
            <Transport size="md" extras />
          </div>
          <div className="mini__volume" data-nodrag>
            <VolumeControl wide />
          </div>
          <div className="mini__lyrics">
            <LyricsView variant="mini" />
          </div>
        </>
      ) : (
        <div className="mini__screen" {...drag}>
          {view === 'loading' && <LoadingScreen />}
          {view === 'connect' && <ConnectScreen />}
          {view === 'offline' && <OfflineScreen />}
          {(view === 'idle' || view === 'ad') && <NoMusicScreen ad={view === 'ad'} />}
        </div>
      )}
    </div>
  )
}
