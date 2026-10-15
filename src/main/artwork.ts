import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger'

const log = createLogger('art')
const MAX_BYTES = 6 * 1024 * 1024
const MAX_FILES = 150
const MEM_LIMIT = 24

// Only fetch artwork from Spotify's image CDNs.
const ALLOWED = /^(?:[a-z0-9-]+\.)*(?:scdn\.co|spotifycdn\.com)$/i

const memory = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
let dir: string | null = null

function cacheDir(): string {
  if (!dir) {
    dir = join(app.getPath('userData'), 'art-cache')
    mkdirSync(dir, { recursive: true })
    try {
      readdirSync(dir)
        .map((f) => ({ f, t: statSync(join(dir!, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
        .slice(MAX_FILES)
        .forEach(({ f }) => rmSync(join(dir!, f), { force: true }))
    } catch {
      /* best effort */
    }
  }
  return dir
}

function remember(url: string, dataUrl: string): void {
  memory.set(url, dataUrl)
  if (memory.size > MEM_LIMIT) memory.delete(memory.keys().next().value as string)
}

async function download(url: string): Promise<string | null> {
  const file = join(cacheDir(), createHash('sha1').update(url).digest('hex'))
  try {
    const meta = readFileSync(file + '.type', 'utf8')
    const data = readFileSync(file)
    return `data:${meta};base64,${data.toString('base64')}`
  } catch {
    /* not cached */
  }
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    if (!type.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) return null
    writeFileSync(file, buf)
    writeFileSync(file + '.type', type)
    return `data:${type};base64,${buf.toString('base64')}`
  } catch (e) {
    log.warn('artwork fetch failed', (e as Error).message)
    return null
  }
}

/** Returns a data URL for the artwork so the renderer needs no network/image permissions. */
export async function getArtwork(url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    host = u.hostname
  } catch {
    return null
  }
  if (!ALLOWED.test(host)) return null

  const hit = memory.get(url)
  if (hit) return hit
  const pending = inflight.get(url)
  if (pending) return pending
  const p = download(url)
    .then((d) => {
      if (d) remember(url, d)
      return d
    })
    .finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}
