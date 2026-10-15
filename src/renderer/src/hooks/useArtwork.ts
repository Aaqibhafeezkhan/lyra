import { useEffect, useState } from 'react'
import { extractPalette, NEUTRAL_PALETTE, type Palette } from '@/lib/palette'

const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

export function loadArtwork(url: string | null): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null)
  let p = pending.get(url)
  if (!p) {
    p = window.lyra.art
      .get(url)
      .catch(() => null)
      .then((d) => {
        cache.set(url, d)
        if (cache.size > 30) cache.delete(cache.keys().next().value as string)
        pending.delete(url)
        return d
      })
    pending.set(url, p)
  }
  return p
}

/** Resolves a remote artwork URL to a locally cached data URL (or null while loading / on failure). */
export function useArtwork(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(url && cache.has(url) ? (cache.get(url) ?? null) : null)
  useEffect(() => {
    let live = true
    if (!url) {
      setSrc(null)
      return
    }
    if (cache.has(url)) setSrc(cache.get(url) ?? null)
    else void loadArtwork(url).then((d) => live && setSrc(d))
    return () => {
      live = false
    }
  }, [url])
  return src
}

export function usePalette(src: string | null): Palette {
  const [pal, setPal] = useState<Palette>(NEUTRAL_PALETTE)
  useEffect(() => {
    let live = true
    if (!src) {
      setPal(NEUTRAL_PALETTE)
      return
    }
    void extractPalette(src).then((p) => live && setPal(p))
    return () => {
      live = false
    }
  }, [src])
  return pal
}
