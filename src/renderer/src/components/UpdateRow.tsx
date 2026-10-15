import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import { Spinner } from './StateScreens'

/** "Updates" line in Settings → About: status plus the one action that makes sense right now. */
export function UpdateRow() {
  const [u, setU] = useState<UpdateState>({ state: 'idle' })

  useEffect(() => {
    void window.lyra.update.get().then(setU)
    return window.lyra.update.onState(setU)
  }, [])

  const text =
    u.state === 'disabled'
      ? u.reason
      : u.state === 'checking'
        ? 'Checking for updates…'
        : u.state === 'none'
          ? 'You’re up to date.'
          : u.state === 'downloading'
            ? `Downloading ${u.version ? `v${u.version}` : 'update'}… ${u.percent}%`
            : u.state === 'ready'
              ? `Version ${u.version} is ready.`
              : u.state === 'error'
                ? u.message
                : 'Updates are checked automatically.'

  return (
    <div className="updaterow">
      <span className="updaterow__text" data-state={u.state}>
        {(u.state === 'checking' || u.state === 'downloading') && <Spinner size={11} />} {text}
      </span>
      {u.state === 'ready' ? (
        <button type="button" className="pill" onClick={() => void window.lyra.update.install()}>
          Restart to update
        </button>
      ) : u.state !== 'disabled' && u.state !== 'checking' && u.state !== 'downloading' ? (
        <button type="button" className="pill" onClick={() => void window.lyra.update.check()}>
          Check now
        </button>
      ) : null}
    </div>
  )
}
