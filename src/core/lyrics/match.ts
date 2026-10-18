/**
 * Pure matching helpers (no Electron / network) so they can be unit-tested.
 * Streaming metadata is messy ("Arz Kiya Hai | Coke Studio Bharat", "Song - Remastered 2011",
 * "Song (feat. X)"), and catalogs list artists differently — so we try several cleaned variants
 * and score candidates instead of trusting a single exact lookup.
 */

const FEAT = /\s*[([](?:feat\.?|ft\.?|with|featuring)\b[^)\]]*[)\]]/gi
const NOISE_WORD = '(?:remaster(?:ed)?|live|mono|stereo|radio edit|single version|album version|bonus track|deluxe|version|edit|mix)'

/** Remove noise that makes catalog matching fail. Keeps the song's actual name. */
export function cleanTitle(title: string): string {
  return title
    .replace(FEAT, '')
    .replace(new RegExp(`\\s*-\\s*(?:\\d{4}\\s*)?${NOISE_WORD}\\b.*$`, 'i'), '')
    .replace(new RegExp(`\\s*[(\\[](?:\\d{4}\\s*)?${NOISE_WORD}[^)\\]]*[)\\]]`, 'gi'), '')
    .replace(/\s*[([]from\b[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ordered, de-duplicated title spellings to try. Most specific first. */
export function titleVariants(title: string): string[] {
  const cleaned = cleanTitle(title)
  const out = [cleaned]
  // "Song | Series Name" / "Song - From the Film"
  const head = cleaned.split(/\s+[|–—]\s+|\s+-\s+(?=from\b|coke|mtv|unplugged|acoustic|cover|official)/i)[0]?.trim()
  if (head) out.push(head)
  const noBrackets = cleaned.replace(/\s*[([][^)\]]*[)\]]/g, '').trim()
  if (noBrackets) out.push(noBrackets)
  return [...new Set(out.filter((t) => t.length > 0))]
}

/** "A, B & C" → ["A, B & C", "A"] — catalogs usually credit the primary artist. */
export function artistVariants(artist: string): string[] {
  const first = artist.split(/\s*(?:,|;|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b)\s*/i)[0]?.trim()
  return [...new Set([artist.trim(), first ?? ''].filter((a) => a.length > 0))]
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 0..1 token similarity; subset matches ("song" vs "song live") score high. */
export function similarity(a: string, b: string): number {
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const tx = new Set(x.split(' '))
  const ty = new Set(y.split(' '))
  let shared = 0
  for (const t of tx) if (ty.has(t)) shared++
  const jaccard = shared / (tx.size + ty.size - shared)
  const containment = shared / Math.min(tx.size, ty.size)
  return Math.max(jaccard, containment >= 1 ? 0.85 : containment * 0.7)
}

export interface Wanted {
  title: string
  artist: string
  durationMs: number
}

export interface Candidate {
  title: string
  artist: string
  durationMs: number
  synced: boolean
}

export const DURATION_TOLERANCE_MS = 5000

/** 0..1+ — higher is better; synced lyrics get a small bonus. */
export function scoreCandidate(want: Wanted, c: Candidate): number {
  const titleSim = Math.max(...titleVariants(want.title).map((t) => similarity(t, c.title)), 0)
  const artistSim = Math.max(...artistVariants(want.artist).map((a) => similarity(a, c.artist)), 0)
  const known = want.durationMs > 0 && c.durationMs > 0
  const diff = known ? Math.abs(want.durationMs - c.durationMs) : 0
  const dur = !known ? 0.6 : diff <= 1500 ? 1 : diff <= DURATION_TOLERANCE_MS ? 0.6 : 0
  return 0.45 * titleSim + 0.3 * artistSim + 0.25 * dur + (c.synced ? 0.05 : 0)
}

/** Strict enough to avoid wrong songs: needs a similar title AND (similar artist or tight duration). */
export function isAcceptable(want: Wanted, c: Candidate): boolean {
  const titleSim = Math.max(...titleVariants(want.title).map((t) => similarity(t, c.title)), 0)
  const artistSim = Math.max(...artistVariants(want.artist).map((a) => similarity(a, c.artist)), 0)
  const known = want.durationMs > 0 && c.durationMs > 0
  const diff = known ? Math.abs(want.durationMs - c.durationMs) : 0
  if (known && diff > DURATION_TOLERANCE_MS) return false
  return titleSim >= 0.6 && (artistSim >= 0.4 || (known && diff <= 2000 && titleSim >= 0.85))
}
