/**
 * Everything the shared core needs from the host platform (Electron today, Android WebView next).
 * Core code must never import Electron, Node, or Android APIs: it only talks to this interface.
 */

export interface Logger {
  debug(...a: unknown[]): void
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
  error(...a: unknown[]): void
}

/** Small persistent JSON document (settings-like data). `set` may be debounced by the host. */
export interface Store<T extends object> {
  get(): T
  set(value: T): void
}

/** Key → string cache with a size cap (lyrics). The host decides where it lives. */
export interface BlobCache {
  read(key: string): string | null
  write(key: string, value: string): void
}

/** One secret string (the user's YouTube API key), kept encrypted by the host when it can. */
export interface SecretStore {
  /** false when the host cannot protect the value (then the key is refused rather than stored in the clear) */
  available(): boolean
  load(): string | null
  save(value: string): void
  clear(): void
}

export interface CorePlatform {
  /** Plain fetch (CORS-free on hosts that can: Electron main, Android native bridge). */
  fetch(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>
  store<T extends object>(name: string, defaults: T): Store<T>
  blobCache(name: string, maxEntries: number): BlobCache
  secret(name: string): SecretStore
  log(scope: string): Logger
  appVersion: string
}

let current: CorePlatform | null = null

export function setPlatform(p: CorePlatform): void {
  current = p
}

export function platform(): CorePlatform {
  if (!current) throw new Error('Lyra core: platform not set (call setPlatform first)')
  return current
}

/** A logger that resolves the platform lazily, so modules can create it at import time. */
export function logger(scope: string): Logger {
  let l: Logger | null = null
  const get = (): Logger => (l ??= platform().log(scope))
  return { debug: (...a) => get().debug(...a), info: (...a) => get().info(...a), warn: (...a) => get().warn(...a), error: (...a) => get().error(...a) }
}
