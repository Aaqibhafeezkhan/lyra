import { app, net, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setPlatform, type BlobCache, type CorePlatform, type SecretStore } from '@core/platform'
import { JsonStore } from './jsonStore'
import { createLogger } from './logger'

/** Key → file cache in userData; keeps only the newest `max` entries. */
class FileBlobCache implements BlobCache {
  private readonly dir: string
  constructor(name: string, max: number) {
    this.dir = join(app.getPath('userData'), name)
    mkdirSync(this.dir, { recursive: true })
    try {
      readdirSync(this.dir)
        .map((f) => ({ f, t: statSync(join(this.dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
        .slice(max)
        .forEach(({ f }) => rmSync(join(this.dir, f), { force: true }))
    } catch {
      /* best effort */
    }
  }
  private file(key: string): string {
    return join(this.dir, createHash('sha1').update(key).digest('hex') + '.json')
  }
  read(key: string): string | null {
    try {
      return readFileSync(this.file(key), 'utf8')
    } catch {
      return null
    }
  }
  write(key: string, value: string): void {
    writeFileSync(this.file(key), value)
  }
}

/** One secret, encrypted with the Windows credential store (DPAPI) via Electron's safeStorage. */
class SafeStorageSecret implements SecretStore {
  private readonly path: string
  constructor(name: string) {
    this.path = join(app.getPath('userData'), `${name}.bin`)
  }
  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }
  load(): string | null {
    try {
      return existsSync(this.path) && this.available() ? safeStorage.decryptString(readFileSync(this.path)) : null
    } catch {
      return null
    }
  }
  save(value: string): void {
    writeFileSync(this.path, safeStorage.encryptString(value))
  }
  clear(): void {
    rmSync(this.path, { force: true })
  }
}

export function installElectronPlatform(): void {
  const platform: CorePlatform = {
    fetch: (url, init) => net.fetch(url, init),
    store: (name, defaults) => new JsonStore(name, defaults),
    blobCache: (name, max) => new FileBlobCache(name, max),
    secret: (name) => new SafeStorageSecret(name),
    log: (scope) => createLogger(scope),
    get appVersion() {
      return app.getVersion()
    }
  }
  setPlatform(platform)
}
