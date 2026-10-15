import { app, net } from 'electron'
import { JsonStore } from '../jsonStore'
import { createLogger } from '../logger'

const log = createLogger('musicbrainz')

/**
 * Release-year lookup via MusicBrainz (free, no key). Their rules: descriptive User-Agent,
 * max ~1 request/second. Results (including misses) are cached on disk.
 */
let cache: JsonStore<{ years: Record<string, number | null> }> | null = null
const store = (): JsonStore<{ years: Record<string, number | null> }> => (cache ??= new JsonStore('release-years.json', { years: {} }))

let chain: Promise<unknown> = Promise.resolve()
let lastCall = 0

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()
const lucene = (s: string): string => s.replace(/["\\]/g, ' ').replace(/[+\-&|!(){}[\]^~*?:/]/g, ' ').trim()

interface MbRecording {
  title: string
  score: number
  length?: number
  'first-release-date'?: string
  'artist-credit'?: Array<{ name: string }>
}

async function query(title: string, artist: string, durationMs: number): Promise<number | null> {
  const q = `recording:"${lucene(title)}" AND artist:"${lucene(artist)}"`
  const res = await net.fetch(`https://musicbrainz.org/ws/2/recording?${new URLSearchParams({ query: q, fmt: 'json', limit: '8' })}`, {
    headers: { 'User-Agent': `Lyra/${app.getVersion()} (https://github.com/DhruvHarani1/lyra)`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`)
  const body = (await res.json()) as { recordings?: MbRecording[] }
  const years = (body.recordings ?? [])
    .filter((r) => r.score >= 90 && r['first-release-date'] && (!r.length || !durationMs || Math.abs(r.length - durationMs) <= 4000))
    .filter((r) => norm(r.title).startsWith(norm(title).slice(0, 8)))
    .map((r) => Number(r['first-release-date']!.slice(0, 4)))
    .filter((y) => y > 1900 && y < 2100)
  // the earliest release is the "original" year
  return years.length ? Math.min(...years) : null
}

export function releaseYear(title: string, artist: string, durationMs: number): Promise<number | null> {
  const key = `${norm(artist)}|${norm(title)}`
  const cached = store().get().years[key]
  if (cached !== undefined) return Promise.resolve(cached)

  const run = chain.then(async () => {
    const wait = lastCall + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    try {
      const year = await query(title, artist, durationMs)
      store().set({ years: { ...store().get().years, [key]: year } })
      return year
    } catch (e) {
      log.warn('lookup failed', (e as Error).message) // not cached: retry next time
      return null
    }
  })
  chain = run.catch(() => undefined)
  return run
}
