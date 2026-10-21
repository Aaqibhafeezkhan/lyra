import { create } from 'zustand'

/** Why no video is playing behind the lyrics (shown as a small note in the mini player). */
export interface BgReason {
  text: string
}

/** What the backdrop is currently showing, so the layout (cinema dock, wrong-video button) can adapt. */
export const useBgState = create<{
  media: 'none' | 'full' | 'mini'
  kind: string | null
  reason: BgReason | null
  /** a lyric video is being recorded: the mini player stops its own video so the export gets all the power */
  exporting: boolean
  setExporting(v: boolean): void
  set(v: { media: 'none' | 'full' | 'mini'; kind: string | null }): void
  setReason(r: BgReason | null): void
}>((set) => ({
  media: 'none',
  kind: null,
  reason: null,
  exporting: false,
  setExporting: (exporting) => set({ exporting }),
  set: (v) => set(v),
  setReason: (reason) => set({ reason })
}))
