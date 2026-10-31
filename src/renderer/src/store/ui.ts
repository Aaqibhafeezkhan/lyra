import { create } from 'zustand'
import type { ViewMode } from '@shared/types'

export type Panel = 'none' | 'queue' | 'moments' | 'settings' | 'lyrics'
export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

interface UiStore {
  mode: ViewMode
  panel: Panel
  distractionFree: boolean
  lyricSideFlipped: boolean
  toasts: Toast[]
  setMode(mode: ViewMode): void
  setPanel(p: Panel): void
  togglePanel(p: Exclude<Panel, 'none'>): void
  toggleDistractionFree(): void
  toggleLyricSide(): void
  toast(message: string, kind?: Toast['kind']): void
  dismissToast(id: number): void
}

let toastId = 0

export const useUi = create<UiStore>((set, get) => ({
  mode: 'compact',
  panel: 'none',
  distractionFree: false,
  lyricSideFlipped: false,
  toasts: [],
  setMode(mode) {
    set({ mode, panel: mode === 'compact' || mode === 'minimal' ? 'none' : get().panel })
  },
  setPanel: (panel) => set({ panel }),
  togglePanel: (p) => set({ panel: get().panel === p ? 'none' : p }),
  toggleDistractionFree: () => set({ distractionFree: !get().distractionFree }),
  toggleLyricSide: () => set({ lyricSideFlipped: !get().lyricSideFlipped }),
  toast(message, kind = 'info') {
    const id = ++toastId
    set({ toasts: [...get().toasts.filter((t) => t.message !== message).slice(-2), { id, message, kind }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** Ask the main process to change window mode; the echo from main updates `mode`. */
export const requestMode = (mode: ViewMode): void => {
  void window.lyra.window.setMode(mode)
}
