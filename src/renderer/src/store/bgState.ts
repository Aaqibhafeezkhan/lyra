import { create } from 'zustand'

/** What the backdrop is currently showing, so the layout (cinema dock, wrong-video button) can adapt. */
export const useBgState = create<{ media: 'none' | 'full' | 'mini'; kind: string | null; set(v: { media: 'none' | 'full' | 'mini'; kind: string | null }): void }>((set) => ({
  media: 'none',
  kind: null,
  set: (v) => set(v)
}))
