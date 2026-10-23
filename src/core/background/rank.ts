import { artistVariants, cleanTitle, normalize, similarity } from '../lyrics/match'

/** Pure ranking of YouTube search results for "the official video of this song". No Electron / network. */

export interface VideoCandidate {
  videoId: string
  title: string
  channel: string
  durationSec: number | null
  embeddable: boolean
}

export interface Wanted {
  title: string
  artist: string
  durationMs: number
}

const BAD = /\b(lyrics?|lyrical|audio|cover|karaoke|reaction|remix|slowed|reverb|8d|nightcore|instrumental|tutorial|status|shorts?|mashup|sped\s*up|reprise|visuali[sz]er|live|concert|fan\s*made|fanmade|edit|animated|amv|mv\s*reaction|full\s*album|playlist|compilation|scenes?|trailer|clips?|tribute|aesthetic|vibes?|cinematic|fan|fans|whatsapp|insta(?:gram)?|tiktok|reels?|movie|mix|ai\s*(?:video|generated)|unplugged|acoustic|dance|choreography)\b/i
const GOOD = /\b(official|vevo|music video|video song|full video|official video)\b/i

/** Remove "(Official Video)", "[HD]", "| T-Series" style noise so the song name is comparable. */
export function cleanVideoTitle(t: string): string {
  return t
    .replace(/[([](?:[^)\]]*?(?:official|video|audio|lyric|hd|4k|full song|music)[^)\]]*?)[)\]]/gi, ' ')
    .replace(/\s*[|–—-]\s*(?:official|full|new|latest).*$/i, '')
    .replace(/\bft\.?\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scoreVideo(want: Wanted, v: VideoCandidate): { score: number; acceptable: boolean } {
  if (!v.embeddable) return { score: -1, acceptable: false }
  const wantTitle = cleanTitle(want.title)
  const vTitle = cleanVideoTitle(v.title)
  const nTitle = normalize(v.title)

  // song title: compare against the cleaned title, and also check it appears inside the raw one
  const titleSim = Math.max(similarity(wantTitle, vTitle), nTitle.includes(normalize(wantTitle)) ? 0.9 : 0)

  const artists = artistVariants(want.artist).map(normalize).filter(Boolean)
  const hay = `${nTitle} ${normalize(v.channel)}`
  const artistHit = artists.some((a) => a.split(' ').every((tok) => tok.length < 3 || hay.includes(tok)))

  let score = 0.5 * titleSim + (artistHit ? 0.25 : 0)
  if (GOOD.test(v.title) || /vevo|records|music|films|entertainment/i.test(v.channel)) score += 0.08
  // penalise variants unless the user's own song title says so
  if (BAD.test(v.title) && !BAD.test(want.title)) score -= 0.3

  if (v.durationSec && want.durationMs > 0) {
    const diff = Math.abs(v.durationSec - want.durationMs / 1000)
    score += diff <= 20 ? 0.2 : diff <= 60 ? 0.1 : diff > 150 ? -0.2 : 0
  }
  // Auto-play only when it is clearly the official video: an "official"-style title, or the artist's own / VEVO channel.
  // Auto-generated "- Topic" channels are a still image, and lyric/audio/live uploads often have burned-in text.
  const chan = normalize(v.channel)
  const ownChannel = artists.some((a) => chan.length > 0 && (chan.includes(a) || a.includes(chan)))
  const official = GOOD.test(v.title) || ownChannel || /vevo/i.test(v.channel)
  const topic = /\btopic$/i.test(v.channel.trim())
  const variant = BAD.test(v.title) && !BAD.test(want.title)
  if (topic) score -= 0.4
  // a video far from the song's length is a different cut, a clip or a compilation: never auto-play it
  const lengthOk = !v.durationSec || want.durationMs <= 0 || Math.abs(v.durationSec - want.durationMs / 1000) <= 30
  return { score, acceptable: titleSim >= 0.6 && artistHit && official && !topic && !variant && lengthOk && score >= 0.62 }
}

/** Best-first. `acceptable` ones are safe to auto-play; the rest only appear in the "pick one" list. */
export function rankVideos(want: Wanted, list: VideoCandidate[]): Array<VideoCandidate & { score: number; acceptable: boolean }> {
  return list
    .map((v) => ({ ...v, ...scoreVideo(want, v) }))
    .filter((v) => v.score > -1)
    .sort((a, b) => b.score - a.score)
}

/** ISO-8601 duration (PT1H2M3S) → seconds. */
export function parseIsoDuration(iso: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '')
  if (!m) return null
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)
}

const KARAOKE = /\b(karaoke|instrumental|backing\s*track|minus\s*one|without\s*vocals?|no\s*vocals?|sing\s*along|sing-along|music\s*only)\b/i
const NOT_KARAOKE = /\b(cover|reaction|remix|slowed|reverb|8d|nightcore|live|concert|tutorial|lesson|review|mashup|sped\s*up|medley|compilation|playlist|full\s*album|piano\s*tutorial)\b/i

/**
 * Ranks YouTube results for "a version of this song to sing along to": the title says karaoke / instrumental, it is
 * the same song (title) and about the same length. Pure, like [scoreVideo].
 */
export function scoreKaraoke(want: Wanted, v: VideoCandidate): { score: number; acceptable: boolean } {
  if (!v.embeddable) return { score: -1, acceptable: false }
  const wantTitle = cleanTitle(want.title)
  const nTitle = normalize(v.title)
  const titleSim = Math.max(similarity(wantTitle, cleanVideoTitle(v.title)), nTitle.includes(normalize(wantTitle)) ? 0.9 : 0)
  const karaoke = KARAOKE.test(v.title)
  const artists = artistVariants(want.artist).map(normalize).filter(Boolean)
  const hay = `${nTitle} ${normalize(v.channel)}`
  const artistHit = artists.some((a) => a.split(' ').every((tok) => tok.length < 3 || hay.includes(tok)))
  let score = 0.45 * titleSim + (karaoke ? 0.35 : 0) + (artistHit ? 0.08 : 0)
  if (/karaoke|backing|sing\s*king|karafun|zoom|instrumental/i.test(v.channel)) score += 0.08
  if (NOT_KARAOKE.test(v.title) && !NOT_KARAOKE.test(want.title)) score -= 0.4
  let lengthOk = true
  if (v.durationSec && want.durationMs > 0) {
    const diff = Math.abs(v.durationSec - want.durationMs / 1000)
    score += diff <= 15 ? 0.2 : diff <= 45 ? 0.08 : -0.2
    lengthOk = diff <= 60
  }
  return { score, acceptable: karaoke && titleSim >= 0.55 && lengthOk && score >= 0.7 }
}

export function rankKaraoke(want: Wanted, list: VideoCandidate[]): Array<VideoCandidate & { score: number; acceptable: boolean }> {
  return list
    .map((v) => ({ ...v, ...scoreKaraoke(want, v) }))
    .filter((v) => v.score > 0.2)
    .sort((a, b) => b.score - a.score)
}
