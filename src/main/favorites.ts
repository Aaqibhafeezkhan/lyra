import { JsonStore } from './jsonStore'

interface Fav {
  title: string
  artist: string
  at: number
}

/** Lyra's own favourites (local only; not synced with Spotify Liked Songs). */
let store: JsonStore<{ items: Record<string, Fav> }> | null = null
const ensure = (): JsonStore<{ items: Record<string, Fav> }> => (store ??= new JsonStore('favorites.json', { items: {} }))

export const favorites = {
  has: (id: string): boolean => id in ensure().get().items,
  set(id: string, liked: boolean, meta: { title: string; artist: string }): void {
    const items = { ...ensure().get().items }
    if (liked) items[id] = { ...meta, at: Date.now() }
    else delete items[id]
    ensure().set({ items })
  },
  flush: (): void => store?.flush()
}
