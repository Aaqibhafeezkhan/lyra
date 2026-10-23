import { useState } from 'react'
import { useIdle } from '@/hooks/useIdle'
import { usePlayerView } from '@/hooks/usePlayerView'
import { useWindowDrag } from '@/hooks/useWindowDrag'
import { joinArtists } from '@/lib/format'
import { useBgState } from '@/store/bgState'
import { usePlayer } from '@/store/player'
import { requestMode, useUi } from '@/store/ui'
import { Artwork } from './Artwork'
import { IconButton, Transport, VolumeControl, useCaps } from './Controls'
import { LyricsView } from './LyricsView'
import { KaraokeScreen } from './KaraokeScreen'
import { RecordDialog } from './RecordDialog'
import { StudioDialog } from './StudioDialog'
import { ProgressBar } from './ProgressBar'
import { ConnectScreen, LoadingScreen, NoMusicScreen, OfflineBanner, OfflineScreen } from './StateScreens'

export function LikeButton({ size = 18 }: { size?: number }) {
  const liked = usePlayer((s) => s.liked)
  const toggle = usePlayer((s) => s.toggleLike)
  const status = usePlayer((s) => s.status)
  const local = status?.state === 'local'
  const unavailable = liked === null
  return (
    <IconButton
      icon="heart"
      label={local ? (liked ? 'Remove from Lyra favorites' : 'Save to Lyra favorites') : liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
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

/** Android: a small switch to turn ambient mode on or off. */
function AmbientSwitch() {
  const on = document.documentElement.dataset.ambient === '1'
  return (
    <span className="ambsw" title="Ambient mode">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M12.1 22c-5.5 0-10-4.5-10-10 0-4.8 3.4-8.9 8-9.8.4-.1.8.3.6.7-.5 1.1-.7 2.3-.7 3.4 0 4.4 3.6 8 8 8 .6 0 1.2-.1 1.8-.2.4-.1.8.3.6.7-1.3 4.2-5.3 7.2-9.8 7.2z" />
      </svg>
      <button type="button" role="switch" aria-checked={on} aria-label="Ambient mode" className="switch switch--sm" onClick={() => void window.lyra.android?.toggleAmbient()}>
        <i />
      </button>
    </span>
  )
}

export function MiniPlayer() {
  const view = usePlayerView()
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const device = usePlayer((s) => s.snapshot?.device ?? null)
  const panel = useUi((s) => s.panel)
  const togglePanel = useUi((s) => s.togglePanel)
  const drag = useWindowDrag()
  const caps = useCaps()
  const videoBehind = useBgState((x) => x.media === 'mini')
  const bgReason = useBgState((x) => x.reason)
  const [noteHidden, setNoteHidden] = useState<string | null>(null)
  // with a video behind it, the header / title / controls fade away after a few seconds and return on touch
  // a touch screen hides after 4 s; with a mouse, give it a little longer
  const [studio, setStudio] = useState(false)
  const [karaoke, setKaraoke] = useState(false)
  const idle = useIdle(document.documentElement.dataset.platform === 'android' ? 4000 : 6000)

  return (
    <>
    {karaoke && <KaraokeScreen onClose={() => setKaraoke(false)} />}
    {studio && (document.documentElement.dataset.platform === 'android' ? <RecordDialog onClose={() => setStudio(false)} /> : <StudioDialog onClose={() => setStudio(false)} />)}
    <div className={`mini ${videoBehind && idle && panel === 'none' ? 'is-idle' : ''}`}>
      <header className="mini__head" {...drag}>
        <span className="mini__device" title={device ? `Playing on ${device.name}` : undefined}>
          {device ? device.name : 'Lyra'}
        </span>
        <div className="mini__tools" data-nodrag>
          {document.documentElement.dataset.platform === 'android' && <AmbientSwitch />}
          {caps.queue && <IconButton icon="queue" label="Queue" active={panel === 'queue'} size={16} onClick={() => togglePanel('queue')} />}
          <IconButton icon="bookmark" label="Saved lyric moments" active={panel === 'moments'} size={16} onClick={() => togglePanel('moments')} />
          {document.documentElement.dataset.platform !== 'android' && <IconButton icon="mic" label="Karaoke" size={16} onClick={() => setKaraoke(true)} />}
          <IconButton icon="film" label={document.documentElement.dataset.platform === 'android' ? 'Record lyric video' : 'Export lyric video'} size={16} onClick={() => setStudio(true)} />
          <IconButton icon="settings" label="Settings" active={panel === 'settings'} size={16} onClick={() => togglePanel('settings')} />
          <IconButton icon="fullscreen" label="Fullscreen lyrics" size={16} onClick={() => requestMode('full')} />
          <IconButton icon="minus" label="Minimize" size={16} onClick={() => window.lyra.window.minimize()} />
          <IconButton icon="collapse" label="Collapse to widget" size={16} onClick={() => requestMode('compact')} />
          <IconButton icon="close" label="Quit Lyra" size={16} onClick={() => window.lyra.window.quit()} />
        </div>
      </header>
      {bgReason && noteHidden !== bgReason.text && track && (
        <div className="mini__bgnote" data-nodrag role="status">
          <span>{bgReason.text}</span>
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem('lyra.settingsTab', 'bg')
              useUi.getState().setPanel('settings')
            }}
          >
            Choose video
          </button>
          <button type="button" aria-label="Hide this note" onClick={() => setNoteHidden(bgReason.text)}>
            ✕
          </button>
        </div>
      )}

      {view === 'playing' && track ? (
        <>
          <OfflineBanner />
          {!videoBehind && (
            <div className="mini__art" {...drag}>
              <Artwork url={track.artworkUrl} size="min(232px, 31vh)" radius={14} className="artwork--lift" />
            </div>
          )}
          <div className="mini__card">
          <div className="mini__info">
            {videoBehind && <Artwork url={track.artworkUrl} size="58px" radius={11} className="artwork--lift" />}
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
    </>
  )
}
