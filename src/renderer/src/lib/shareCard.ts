/**
 * Draws a shareable lyric card (story size, 1080x1920) on a canvas: the song's colours, a soft blurred cover,
 * a few chosen lines in big type, the song title and a small Lyra mark. Entirely local; nothing is uploaded.
 */
export interface CardInput {
  lines: string[]
  title: string
  artist: string
  artworkUrl: string | null
  accent: string
  tint1: string
  tint2: string
}

export const CARD_W = 1080
export const CARD_H = 1920
const SITE = 'lyra-website-rho.vercel.app'

function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous' // a remote image without CORS would taint the canvas: then we skip it
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) {
      out.push(line)
      line = w
    } else line = t
  }
  if (line) out.push(line)
  return out
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export async function drawCard(canvas: HTMLCanvasElement, c: CardInput): Promise<boolean> {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')!
  const family = getComputedStyle(document.body).fontFamily || 'Inter, system-ui, sans-serif'
  const art = await loadImage(c.artworkUrl)

  // background: the song's colours, then a blurred cover, then a dark veil so the type stays readable
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H)
  g.addColorStop(0, c.tint1)
  g.addColorStop(1, c.tint2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (art) {
    ctx.save()
    ctx.filter = 'blur(60px) saturate(1.6) brightness(1.15)'
    const s = Math.max(CARD_W / art.width, CARD_H / art.height) * 1.25
    ctx.globalAlpha = 1
    ctx.drawImage(art, (CARD_W - art.width * s) / 2, (CARD_H - art.height * s) / 2, art.width * s, art.height * s)
    ctx.restore()
  }
  const veil = ctx.createLinearGradient(0, 0, 0, CARD_H)
  veil.addColorStop(0, 'rgba(0,0,0,0.12)')
  veil.addColorStop(0.5, 'rgba(0,0,0,0.22)')
  veil.addColorStop(1, 'rgba(0,0,0,0.62)')
  ctx.fillStyle = veil
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // the lines: as big as will fit
  const margin = 96
  const maxW = CARD_W - margin * 2
  let size = 112
  let wrapped: string[] = []
  const maxBlock = 900
  for (; size >= 52; size -= 4) {
    ctx.font = `800 ${size}px ${family}`
    wrapped = c.lines.flatMap((l) => wrap(ctx, l, maxW))
    if (wrapped.length * size * 1.16 <= maxBlock) break
  }
  const lh = size * 1.16
  const blockH = wrapped.length * lh
  let y = (CARD_H - blockH) / 2 - 40
  ctx.fillStyle = c.accent
  roundRect(ctx, margin, y - 70, 120, 10, 5)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 24
  for (const l of wrapped) {
    ctx.fillText(l, margin, y)
    y += lh
  }
  ctx.shadowBlur = 0

  // the song
  const by = CARD_H - 330
  const cover = 150
  if (art) {
    ctx.save()
    roundRect(ctx, margin, by, cover, cover, 30)
    ctx.clip()
    ctx.drawImage(art, margin, by, cover, cover)
    ctx.restore()
  }
  const tx = margin + (art ? cover + 34 : 0)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 46px ${family}`
  ctx.fillText(ellipsize(ctx, c.title, CARD_W - margin - tx), tx, by + 22)
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = `500 38px ${family}`
  ctx.fillText(ellipsize(ctx, c.artist, CARD_W - margin - tx), tx, by + 88)

  // the mark
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `800 40px ${family}`
  ctx.fillText('Lyra', margin, CARD_H - 120)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = `500 30px ${family}`
  ctx.fillText(SITE, margin + 110, CARD_H - 115)
  return true
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}

export function cardDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}
