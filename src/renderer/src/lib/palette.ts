export interface Palette {
  /** Readable, fairly light tint for small accents (focus ring, dots). */
  accent: string
  /** Deep, saturated-but-dark colours for backgrounds. */
  tint1: string
  tint2: string
}

export const NEUTRAL_PALETTE: Palette = { accent: '#d8d8d8', tint1: '#1a1a1a', tint2: '#101010' }

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

const hsl = (h: number, s: number, l: number): string => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`

const cache = new Map<string, Palette>()

/** Extracts two dominant hues from an image data URL using a coarse colour histogram. */
export async function extractPalette(src: string): Promise<Palette> {
  const hit = cache.get(src)
  if (hit) return hit
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  try {
    await img.decode()
  } catch {
    return NEUTRAL_PALETTE
  }
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return NEUTRAL_PALETTE
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)

  // bucket by hue (12 sectors); weight vivid, mid-lightness pixels most
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }))
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 255) < 200) continue
    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!)
    if (l < 0.08 || l > 0.94) continue
    const weight = 0.15 + s * (1 - Math.abs(l - 0.5) * 1.4)
    const b = buckets[Math.floor(h / 30) % 12]!
    b.w += weight
    b.h += h * weight
    b.s += s * weight
    b.l += l * weight
  }
  const ranked = buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w)
  const first = ranked[0]
  if (!first) {
    cache.set(src, NEUTRAL_PALETTE)
    return NEUTRAL_PALETTE
  }
  const avg = (b: (typeof buckets)[number]) => ({ h: b.h / b.w, s: b.s / b.w, l: b.l / b.w })
  const a = avg(first)
  const second = ranked.find((b) => Math.abs(avg(b).h - a.h) > 25 && Math.abs(avg(b).h - a.h) < 335) ?? ranked[1] ?? first
  const c = avg(second)

  const pal: Palette = {
    accent: hsl(a.h, Math.min(0.75, Math.max(0.35, a.s)), 0.72),
    tint1: hsl(a.h, Math.min(0.55, Math.max(0.2, a.s * 0.8)), 0.2),
    tint2: hsl(c.h, Math.min(0.5, Math.max(0.18, c.s * 0.75)), 0.14)
  }
  if (cache.size > 40) cache.delete(cache.keys().next().value as string)
  cache.set(src, pal)
  return pal
}
