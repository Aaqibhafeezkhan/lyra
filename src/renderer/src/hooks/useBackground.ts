import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { BackgroundResolution } from '@shared/types'
import { useSettings } from '@/store/settings'
import { usePlayer } from '@/store/player'

/** Bumped whenever something the resolver depends on changes outside settings (API key, per-song pick/clear, chosen video). */
export const useBackgroundVersion = create<{ v: number; bump: () => void }>((set) => ({ v: 0, bump: () => set((s) => ({ v: s.v + 1 })) }))

/** What should sit behind the current song. Null until resolved; the previous result stays while the next one loads. */
export function useBackground(enabled: boolean): BackgroundResolution | null {
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const style = useSettings((s) => s.settings.backgroundStyle)
  const globalFile = useSettings((s) => s.settings.customBackground?.file ?? null)
  const version = useBackgroundVersion((s) => s.v)
  const [res, setRes] = useState<BackgroundResolution | null>(null)
  const id = track?.id ?? null

  useEffect(() => {
    if (!enabled || !track) {
      setRes(null)
      return
    }
    let cancelled = false
    void window.lyra.background
      .resolve(track)
      .then((r) => !cancelled && setRes(r))
      .catch(() => !cancelled && setRes(null))
    return () => {
      cancelled = true
    }
    // track object identity changes every poll; the id is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id, style, globalFile, version])

  return res
}
