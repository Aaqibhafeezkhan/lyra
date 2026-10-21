import type { VideoCrop } from '@shared/types'

/** The picture of a YouTube video playing in the hidden window (see studio.ts in the main process): always the newest frame. */
export class StageSource {
  bitmap: ImageBitmap | null = null
  crop: VideoCrop | null
  private off: () => void
  private busy = false

  constructor(crop: VideoCrop | null) {
    this.crop = crop
    this.off = window.lyra.studio.onFrame((jpeg) => {
      if (this.busy) return // still decoding the last one: skip, the next frame is a moment away
      this.busy = true
      void createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }))
        .then((b) => {
          this.bitmap?.close()
          this.bitmap = b
        })
        .catch(() => undefined)
        .finally(() => {
          this.busy = false
        })
    })
  }

  /** Resolves once the first picture has arrived (or after a timeout). Also finds black bars in the picture itself. */
  async firstFrame(ms = 8000): Promise<boolean> {
    const t0 = performance.now()
    while (!this.bitmap && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50))
    if (this.bitmap) {
      // black bars (letterboxing) inside the video would be zoomed into the frame: trim what the thumbnail check missed
      const seen = detectBars(this.bitmap)
      const c = this.crop ?? { t: 0, r: 0, b: 0, l: 0 }
      this.crop = { t: Math.max(c.t, seen.t), r: Math.max(c.r, seen.r), b: Math.max(c.b, seen.b), l: Math.max(c.l, seen.l) }
    }
    return !!this.bitmap
  }

  close(): void {
    this.off()
    this.bitmap?.close()
    this.bitmap = null
  }
}

/**
 * Looks at a small copy of the picture and returns how much of each side is (nearly) black, as a fraction. Only bars
 * between 3% and 30% of a side count; the video's own dark scenes at the very start are not mistaken for bars because
 * a bar must be dark in every pixel of its rows.
 */
export function detectBars(b: ImageBitmap): VideoCrop {
  const W = 96
  const H = 54
  const c = new OffscreenCanvas(W, H)
  const x = c.getContext('2d', { willReadFrequently: true })
  if (!x) return { t: 0, r: 0, b: 0, l: 0 }
  x.drawImage(b, 0, 0, W, H)
  const px = x.getImageData(0, 0, W, H).data
  const dark = (col: number, row: number): boolean => {
    const i = (row * W + col) * 4
    return px[i]! + px[i + 1]! + px[i + 2]! < 3 * 18
  }
  const rowDark = (row: number): boolean => {
    for (let col = 0; col < W; col++) if (!dark(col, row)) return false
    return true
  }
  const colDark = (col: number): boolean => {
    for (let row = 0; row < H; row++) if (!dark(col, row)) return false
    return true
  }
  let t = 0
  while (t < H * 0.3 && rowDark(t)) t++
  let bt = 0
  while (bt < H * 0.3 && rowDark(H - 1 - bt)) bt++
  let l = 0
  while (l < W * 0.3 && colDark(l)) l++
  let r = 0
  while (r < W * 0.3 && colDark(W - 1 - r)) r++
  const f = (n: number, of: number): number => (n / of >= 0.03 ? Math.min(0.3, (n + 0.5) / of) : 0)
  return { t: f(t, H), b: f(bt, H), l: f(l, W), r: f(r, W) }
}
