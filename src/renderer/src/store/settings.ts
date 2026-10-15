import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

interface SettingsStore {
  settings: Settings
  loaded: boolean
  init(): Promise<void>
  set(patch: Partial<Settings>): void
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async init() {
    set({ settings: await window.lyra.settings.get(), loaded: true })
    window.lyra.settings.onChange((s) => set({ settings: s }))
  },
  set(patch) {
    set({ settings: { ...get().settings, ...patch } }) // optimistic; main echoes the sanitised value back
    void window.lyra.settings.set(patch)
  }
}))
