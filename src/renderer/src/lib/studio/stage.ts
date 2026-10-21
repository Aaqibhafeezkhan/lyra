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

  /** Resolves once the first picture has arrived (or after a timeout). */
  async firstFrame(ms = 8000): Promise<boolean> {
    const t0 = performance.now()
    while (!this.bitmap && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50))
    return !!this.bitmap
  }

  close(): void {
    this.off()
    this.bitmap?.close()
    this.bitmap = null
  }
}
