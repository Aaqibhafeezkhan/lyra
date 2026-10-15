import type { LyraApi } from '@shared/ipc'

declare global {
  interface Window {
    lyra: LyraApi
  }
}

export {}
