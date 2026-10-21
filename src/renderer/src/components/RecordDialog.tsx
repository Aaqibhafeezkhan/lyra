import { useEffect, useState, type ReactElement } from 'react'
import { usePlayer } from '@/store/player'

/** Android: record a lyric video of the song playing now (the phone films Lyra's screen and Spotify's sound). */
export function RecordDialog({ onClose }: { onClose: () => void }): ReactElement {
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [phones, setPhones] = useState(false)
  useEffect(() => {
    void window.lyra.android?.audioRoute().then((r) => setPhones(r.headphones)).catch(() => undefined)
  }, [])

  const start = async (fromStart: boolean): Promise<void> => {
    setBusy(true)
    const r = await window.lyra.android?.recordVideo(fromStart).catch((e: Error) => ({ ok: false, error: e.message }))
    if (r?.ok) onClose()
    else {
      setBusy(false)
      setError(r?.error ?? 'Recording is not available here.')
    }
  }

  return (
    <div className="sharecard" role="dialog" aria-label="Record a lyric video" data-nodrag>
      <div className="sharecard__box studio">
        <header>
          <b>Record lyric video</b>
          <button type="button" className="ibtn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {track ? (
          <p className="studio__song">
            <b>{track.title}</b> · {track.artists.join(', ')}
          </p>
        ) : (
          <p className="studio__song">Play a song in Spotify first.</p>
        )}
        <p className="studio__song">
          Lyra films its own screen (lyrics and the song's video) together with the song's sound, then saves the video to Movies/Lyra and lets you share it. Android asks first for sound and screen recording.
          Some phones do not hand Spotify's sound to other apps. Then Lyra listens through the microphone instead: keep the music on the phone speaker (not headphones), turn it up, and stay quiet. Do Not Disturb keeps notifications out of the picture.
        </p>
        {phones && (
          <p className="studio__song" style={{ color: '#ffb36b' }}>
            Headphones or a Bluetooth speaker are connected. If this phone does not hand over the song's sound, the microphone would hear nothing: unplug them or switch the sound to the phone speaker first.
          </p>
        )}
        {error && <p className="studio__song" style={{ color: "#ff8a8a" }}>{error}</p>}
        <div className="studio__group">
          <button type="button" className="pill pill--primary" disabled={!track || busy} onClick={() => void start(true)}>
            Record from the start of the song
          </button>
          <button type="button" className="pill" disabled={!track || busy} onClick={() => void start(false)}>
            Record from where it is now
          </button>
        </div>
      </div>
    </div>
  )
}
