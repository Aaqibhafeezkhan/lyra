import { randomUUID } from 'node:crypto'
import type { SavedMoment } from '@shared/types'
import { JsonStore } from './jsonStore'

/** The user's personal collection of memorable lines. Stored locally only. */
let store: JsonStore<{ items: SavedMoment[] }> | null = null
const ensure = (): JsonStore<{ items: SavedMoment[] }> => (store ??= new JsonStore('moments.json', { items: [] }))

export const moments = {
  list: (): SavedMoment[] => ensure().get().items,
  add(m: Omit<SavedMoment, 'id' | 'savedAt'>): SavedMoment[] {
    const items = ensure().get().items
    const dup = items.find((x) => x.trackId === m.trackId && x.text === m.text)
    if (dup) return items
    const next = [{ ...m, id: randomUUID(), savedAt: Date.now() }, ...items].slice(0, 500)
    ensure().set({ items: next })
    return next
  },
  remove(id: string): SavedMoment[] {
    const next = ensure().get().items.filter((x) => x.id !== id)
    ensure().set({ items: next })
    return next
  },
  flush: (): void => store?.flush()
}
