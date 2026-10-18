import type { VideoCrop } from '@shared/types'
import { logger, platform } from '../platform'

const log = logger('thumbcrop')
const cache = new Map<string, VideoCrop | null>()
const MAX_BAR = 0.3

/** A decoded image: raw pixels in 4 bytes each, either blue-green-red-alpha or red-green-blue-alpha order. */
export interface DecodedImage {
  width: number
  height: number
  pixels: Uint8Array | Uint8ClampedArray
  order: 'bgra' | 'rgba'
}

/**
 * The YouTube embed is a sealed box we can't read pixels from, but the video's thumbnail is a frame of the same
 * picture. If that frame has black bars (letterbox / pillarbox) at the edges, report how much to trim.
 * Conservative: bars must be symmetric and the picture inside must not itself be dark.
 *
 * `decode` is supplied by the host (Electron: nativeImage; Android: a canvas), so this file stays platform-free.
 */
export async function thumbCrop(videoId: string, decode: (bytes: ArrayBuffer) => Promise<DecodedImage | null>): Promise<VideoCrop | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
  if (cache.has(videoId)) return cache.get(videoId) ?? null
  let crop: VideoCrop | null = null
  try {
    // mqdefault is 16:9 (hqdefault adds its own bars), so any bars we see belong to the video
    const res = await platform().fetch(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const img = await decode(await res.arrayBuffer())
      if (img && img.width > 0 && img.height > 0) crop = detectBars(img)
    }
  } catch (e) {
    log.warn('thumbnail check failed', (e as Error).message)
  }
  cache.set(videoId, crop)
  return crop
}

export function detectBars({ pixels, width: W, height: H, order }: DecodedImage): VideoCrop | null {
  const [ri, bi] = order === 'bgra' ? [2, 0] : [0, 2]
  const lum = (x: number, y: number): number => {
    const i = (y * W + x) * 4
    return (0.2126 * pixels[i + ri]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + bi]!) / 255
  }
  const dark = (fixed: number, vertical: boolean): boolean => {
    const n = vertical ? H : W
    let sum = 0
    let max = 0
    for (let k = 0; k < n; k++) {
      const l = vertical ? lum(fixed, k) : lum(k, fixed)
      sum += l
      if (l > max) max = l
    }
    return sum / n < 0.05 && max < 0.16
  }
  const count = (from: number, size: number, vertical: boolean): number => {
    let c = 0
    while (c < size * MAX_BAR && dark(from === 0 ? c : size - 1 - c, vertical)) c++
    return c
  }
  const t = count(0, H, false)
  const b = count(1, H, false)
  const l = count(0, W, true)
  const r = count(1, W, true)
  // letterbox bars are symmetric: use the smaller side, ignore anything lopsided
  const v = Math.min(t, b) / H
  const h = Math.min(l, r) / W
  if (v < 0.04 && h < 0.04) return null
  // the picture inside must have some brightness, otherwise this is just a dark frame
  let sum = 0
  let n = 0
  const y0 = Math.round(v * H)
  const x0 = Math.round(h * W)
  for (let y = y0; y < H - y0; y += 3) for (let x = x0; x < W - x0; x += 3) (sum += lum(x, y)), n++
  if (!n || sum / n < 0.07) return null
  return { t: v, b: v, l: h, r: h }
}
