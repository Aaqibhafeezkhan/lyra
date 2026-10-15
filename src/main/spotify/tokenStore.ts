import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '../logger'

const log = createLogger('tokens')

export interface TokenRecord {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
  clientId: string
}

/**
 * Persists tokens encrypted with the OS credential store (Windows DPAPI via safeStorage).
 * If encryption is unavailable we keep tokens in memory only — never plaintext on disk.
 */
export class TokenStore {
  private memory: TokenRecord | null = null
  private get file(): string {
    return join(app.getPath('userData'), 'spotify-auth.bin')
  }

  load(): TokenRecord | null {
    if (this.memory) return this.memory
    try {
      if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return null
      const json = safeStorage.decryptString(readFileSync(this.file))
      this.memory = JSON.parse(json) as TokenRecord
      return this.memory
    } catch (e) {
      log.warn('stored tokens unreadable; ignoring', e)
      this.clear()
      return null
    }
  }

  save(rec: TokenRecord): void {
    this.memory = rec
    try {
      if (safeStorage.isEncryptionAvailable()) writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(rec)))
      else log.warn('OS encryption unavailable; session tokens kept in memory only')
    } catch (e) {
      log.error('could not persist tokens', e)
    }
  }

  clear(): void {
    this.memory = null
    try {
      rmSync(this.file, { force: true })
    } catch {
      /* already gone */
    }
  }
}
