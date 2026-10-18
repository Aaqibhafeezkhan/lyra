import { nativeImage, net } from 'electron'
import type { VideoCrop } from '@shared/types'
import { createLogger } from '../logger'

const log = createLogger('thumbcrop')
const cache = new Map<string, VideoCrop | null>()
const MAX_BAR = 0.3

/**
 * The YouTube embed is a sealed box we can't read pixels from, but the video's thumbnail is a frame of the same
 * picture. If that frame has black bars (letterbox / pillarbox) at the edges, report how much to trim.
 * Conservative: bars must be symmetric and the picture inside must not itself be dark.
 */
export async function thumbCrop(videoId: string): Promise<VideoCrop | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
  if (cache.has(videoId)) return cache.get(videoId) ?? null
  let crop: VideoCrop | null = null
  try {
    // mqdefault is 16:9 (hqdefault adds its own bars), so any bars we see belong to the video
    const res = await net.fetch(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
      const { width: W, height: H } = img.getSize()
      if (W > 0 && H > 0) crop = detect(img.toBitmap(), W, H)
    }
  } catch (e) {
    log.warn('thumbnail check failed', (e as Error).message)
  }
  cache.set(videoId, crop)
  return crop
}

function detect(bgra: Buffer, W: number, H: number): VideoCrop | null {
  const lum = (x: number, y: number): number => {
    const i = (y * W + x) * 4
    return (0.2126 * bgra[i + 2]! + 0.7152 * bgra[i + 1]! + 0.0722 * bgra[i]!) / 255
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
