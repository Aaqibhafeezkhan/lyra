import { useIdle } from '@/hooks/useIdle'
import { usePlayerView } from '@/hooks/usePlayerView'
import { joinArtists } from '@/lib/format'
import { useBgState } from '@/store/bgState'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { requestMode, useUi } from '@/store/ui'
import { Artwork } from './Artwork'
import { IconButton, Transport, VolumeControl, useCaps } from './Controls'
import { LyricsView } from './LyricsView'
import { LikeButton } from './MiniPlayer'
import { ProgressBar } from './ProgressBar'
import { VideoPicker } from './VideoPicker'
import { ConnectScreen, LoadingScreen, NoMusicScreen, OfflineBanner, OfflineScreen } from './StateScreens'

export function FullscreenPlayer() {
  const view = usePlayerView()
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const device = usePlayer((s) => s.snapshot?.device ?? null)
  const idle = useIdle(3500)
  const caps = useCaps()
  const panel = useUi((s) => s.panel)
  const togglePanel = useUi((s) => s.togglePanel)
  const df = useUi((s) => s.distractionFree)
  const toggleDf = useUi((s) => s.toggleDistractionFree)
  const sideFlipped = useUi((s) => s.lyricSideFlipped)

  const quiet = idle && panel === 'none'
  // cinema layout: a video is playing, so get the UI out of its way
  const cinema = useBgState((s) => s.media === 'full')
  const layout = useSettings((s) => s.settings.fullLayout)
  const ytVideo = useBgState((s) => s.kind === 'youtube')

  return (
    <div className={`full ${quiet ? 'is-idle' : ''} ${df ? 'is-df' : ''} ${sideFlipped ? 'is-side-flipped' : ''} ${cinema ? `is-cinema layout-${layout}` : ''}`}>
      <header className="full__top">
        <span className="full__device">{device ? `Playing on ${device.name}` : 'Lyra'}</span>
        <div className="full__tools">
          {cinema && ytVideo && <VideoPicker />}
          <IconButton icon="type" label="Distraction-free: artwork and lyrics only" active={df} onClick={toggleDf} />
          {caps.queue && <IconButton icon="queue" label="Queue" active={panel === 'queue'} onClick={() => togglePanel('queue')} />}
          <IconButton icon="bookmark" label="Saved lyric moments" active={panel === 'moments'} onClick={() => togglePanel('moments')} />
          <IconButton icon="settings" label="Settings" active={panel === 'settings'} onClick={() => togglePanel('settings')} />
          <IconButton icon="exitFullscreen" label="Exit fullscreen (Esc)" onClick={() => requestMode('mini')} />
        </div>
      </header>

      {view === 'playing' && track ? (
        <div className="full__body">
          <aside className="full__side">
            <Artwork url={track.artworkUrl} size={cinema ? 'clamp(84px, 12vh, 124px)' : 'min(34vw, 46vh, 460px)'} radius={cinema ? 14 : 18} className="artwork--lift" />
            <div className="full__chrome">
              <div className="full__titlerow">
                <div className="full__titles">
                  <h1 title={track.title}>{track.title}</h1>
                  <p className="full__artist">{joinArtists(track.artists)}</p>
                  <p className="full__album">
                    {track.album}
                    {track.releaseYear ? ` · ${track.releaseYear}` : ''}
                  </p>
                </div>
                <LikeButton size={22} />
              </div>
              <ProgressBar showTimes remaining />
              <div className="full__controls">
                <Transport size="lg" extras />
              </div>
              <div className="full__volume">
                <VolumeControl wide />
                <IconButton icon="external" label="Open in Spotify" size={16} onClick={() => void window.lyra.player.openInSpotify(track)} />
              </div>
            </div>
          </aside>
          <section className="full__lyrics">
            <LyricsView variant="full" />
          </section>
          <OfflineBanner />
        </div>
      ) : (
        <div className="full__screen">
          {view === 'loading' && <LoadingScreen />}
          {view === 'connect' && <ConnectScreen />}
          {view === 'offline' && <OfflineScreen />}
          {(view === 'idle' || view === 'ad') && <NoMusicScreen ad={view === 'ad'} />}
        </div>
      )}
    </div>
  )
}
