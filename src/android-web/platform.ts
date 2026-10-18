import { setPlatform, type BlobCache, type CorePlatform, type Logger, type SecretStore, type Store } from '@core/platform'
import { nativeFetch, rpc } from './rpc'

/** A small JSON document kept in the WebView's localStorage (written a moment after the last change). */
export class LocalStore<T extends object> implements Store<T> {
  private data: T
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly key: string

  constructor(name: string, private readonly defaults: T) {
    this.key = `lyra:store:${name}`
    this.data = this.load()
  }

  private load(): T {
    try {
      const raw = localStorage.getItem(this.key)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<T>
        return Array.isArray(this.defaults) ? (parsed as T) : { ...this.defaults, ...parsed }
      }
    } catch {
      /* fall through to defaults */
    }
    return structuredClone(this.defaults)
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data))
    } catch {
      /* storage full: keep running with the in-memory copy */
    }
  }
}

/** Key → string cache in localStorage that forgets its oldest entries beyond `max`. */
class LocalBlobCache implements BlobCache {
  private readonly prefix: string
  private readonly indexKey: string
  private index: string[]

  constructor(name: string, private readonly max: number) {
    this.prefix = `lyra:cache:${name}:`
    this.indexKey = `${this.prefix}#index`
    try {
      this.index = JSON.parse(localStorage.getItem(this.indexKey) ?? '[]') as string[]
    } catch {
      this.index = []
    }
  }

  read(key: string): string | null {
    return localStorage.getItem(this.prefix + key)
  }

  write(key: string, value: string): void {
    const put = (): void => {
      localStorage.setItem(this.prefix + key, value)
    }
    try {
      put()
    } catch {
      // storage is full: drop the older half and try once more
      this.evict(Math.ceil(this.index.length / 2))
      put()
    }
    this.index = this.index.filter((k) => k !== key)
    this.index.push(key)
    if (this.index.length > this.max) this.evict(this.index.length - this.max)
    localStorage.setItem(this.indexKey, JSON.stringify(this.index))
  }

  private evict(n: number): void {
    for (const k of this.index.splice(0, n)) localStorage.removeItem(this.prefix + k)
  }
}

/** Secrets live encrypted in the Android Keystore. The page reads them once at startup (the core asks synchronously). */
const secretCache = new Map<string, string | null>()
export async function preloadSecrets(names: string[]): Promise<void> {
  await Promise.all(names.map(async (n) => secretCache.set(n, await rpc<string | null>('secretLoad', n).catch(() => null))))
}
const secretStore = (name: string): SecretStore => ({
  available: () => true,
  load: () => secretCache.get(name) ?? null,
  save: (v) => {
    secretCache.set(name, v)
    void rpc('secretSave', name, v)
  },
  clear: () => {
    secretCache.set(name, null)
    void rpc('secretClear', name)
  }
})

function consoleLogger(scope: string): Logger {
  const tag = `[${scope}]`
  return {
    debug: (...a) => console.debug(tag, ...a),
    info: (...a) => console.info(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),
    error: (...a) => console.error(tag, ...a)
  }
}

let version = '0'
export function setAppVersion(v: string): void {
  version = v
}

export function installAndroidPlatform(): void {
  const platform: CorePlatform = {
    fetch: (url, init) => nativeFetch(url, init),
    store: (name, defaults) => new LocalStore(name, defaults),
    blobCache: (name, max) => new LocalBlobCache(name, max),
    secret: secretStore,
    log: consoleLogger,
    get appVersion() {
      return version
    }
  }
  setPlatform(platform)
}
