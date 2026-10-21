import { romanizeLyrics } from '@core/lyrics/romanize'
import type { LyricLine } from '@shared/types'

/**
 * One frame of an exported lyric video, drawn on a canvas at any size and shape (9:16, 4:5, 1:1, 16:9).
 * Pure drawing: given the playback position it paints the background, the scrolling lyrics (current line filling
 * word by word), the song title and a moving Lyra logo. The recorder calls draw() once per video frame.
 */
export interface SceneInput {
  w: number
  h: number
  lines: LyricLine[]
  title: string
  artist: string
  art: HTMLImageElement | null
  /** a YouTube video playing in the hidden window: its newest frame is drawn behind the lyrics */
  stage?: { bitmap: ImageBitmap | null; crop: { t: number; r: number; b: number; l: number } | null } | null
  /** a looping video or a photo behind the lyrics; null = the cover's colours */
  media: HTMLVideoElement | HTMLImageElement | null
  logo: HTMLImageElement | null
  accent: string
  tint1: string
  tint2: string
  showSong: boolean
  fontFamily: string
  totalMs: number
  /** how the lyrics are laid out */
  style: 'scroll' | 'focus' | 'subtitle'
  /** the colour a word fills with while it is sung */
  fill: string
  position: 'upper' | 'middle' | 'lower'
  /** a smaller Roman-letter line under Hindi / Punjabi lines */
  romanize?: boolean
}

interface Placed {
  words: Array<{ text: string; timeMs: number | null }>
  rows: Array<Array<number>> // indexes into words, per wrapped row
  rowWidths: number[]
  top: number
  height: number
  /** the Roman-letter reading, wrapped into rows (empty when not shown) */
  roman: string[]
}

export interface Scene {
  draw(ctx: CanvasRenderingContext2D, posMs: number, tSec: number): void
  /** the closing card; k runs 0..1 over its duration */
  endCard(ctx: CanvasRenderingContext2D, k: number, tSec: number): void
}

export function createScene(inp: SceneInput): Scene {
  const { w, h } = inp
  const base = Math.min(w, h)
  const portrait = h >= w
  // a tall (9:16) video is shown inside Reels / TikTok / Shorts, which cover the top ~12%, the bottom ~22% and the right
  // ~12% with their own buttons and captions: keep everything that matters inside the safe middle
  const tall = h / w >= 1.6
  const margin = Math.round(base * (portrait ? 0.085 : 0.07))
  const sizeMul = inp.style === 'focus' ? 1.28 : inp.style === 'subtitle' ? 0.74 : 1
  const centered = inp.style !== 'scroll'
  const fontSize = Math.round(base * (tall ? 0.082 : portrait ? 0.074 : 0.078) * sizeMul)
  const lineH = Math.round(fontSize * 1.18)
  const gap = Math.round(fontSize * 0.55)
  const romanSize = Math.round(fontSize * 0.58)
  const romanLineH = Math.round(romanSize * 1.25)
  const romanGap = Math.round(fontSize * 0.1)
  // lyrics column: the whole width in portrait/square, the right 62% in landscape (the song sits left)
  const colX = portrait ? margin : Math.round(w * 0.36)
  const colW = w - colX - margin - (tall ? Math.round(w * 0.1) : 0)
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `800 ${fontSize}px ${inp.fontFamily}`
  const space = measure.measureText(' ').width

  // lay every line out once (wrapping + position in the column)
  const placed: Placed[] = []
  let y = 0
  for (const line of inp.lines) {
    const words = line.words && line.words.length > 1 ? line.words.map((x) => ({ text: x.text, timeMs: x.timeMs })) : (line.text.match(/\S+/g) ?? []).map((t) => ({ text: t, timeMs: null as number | null }))
    const rows: number[][] = []
    const rowWidths: number[] = []
    let cur: number[] = []
    let curW = 0
    words.forEach((wd, i) => {
      const ww = measure.measureText(wd.text).width
      if (cur.length && curW + space + ww > colW) {
        rows.push(cur)
        rowWidths.push(curW)
        cur = []
        curW = 0
      }
      curW += (cur.length ? space : 0) + ww
      cur.push(i)
    })
    if (cur.length) {
      rows.push(cur)
      rowWidths.push(curW)
    }
    // the Roman-letter reading, smaller, wrapped to the same column
    const roman: string[] = []
    if (inp.romanize) {
      const reading = romanizeLyrics(line.text)
      if (reading !== line.text) {
        measure.font = `600 ${romanSize}px ${inp.fontFamily}`
        let row = ''
        for (const word of reading.split(/\s+/).filter(Boolean)) {
          const trial = row ? `${row} ${word}` : word
          if (row && measure.measureText(trial).width > colW) {
            roman.push(row)
            row = word
          } else row = trial
        }
        if (row) roman.push(row)
        measure.font = `800 ${fontSize}px ${inp.fontFamily}`
      }
    }
    const height = Math.max(1, rows.length) * lineH + (roman.length ? romanGap + roman.length * romanLineH : 0)
    placed.push({ words, rows, rowWidths, top: y, height, roman })
    y += height + gap
  }

  // a pre-blurred cover, drawn slowly drifting when there is no media behind
  let blurred: HTMLCanvasElement | null = null
  if (inp.art) {
    blurred = document.createElement('canvas')
    const bw = Math.round(w / 3)
    const bh = Math.round(h / 3)
    blurred.width = bw
    blurred.height = bh
    const c = blurred.getContext('2d')!
    c.filter = `blur(${Math.round(bw / 10)}px) saturate(1.5) brightness(1.1)`
    const s = Math.max(bw / inp.art.width, bh / inp.art.height) * 1.5
    c.drawImage(inp.art, (bw - inp.art.width * s) / 2, (bh - inp.art.height * s) / 2, inp.art.width * s, inp.art.height * s)
  }

  let scroll = 0
  let lastT = 0

  function cover(ctx: CanvasRenderingContext2D, el: CanvasImageSource, sw: number, sh: number, zoom = 1, dx = 0, dy = 0): void {
    const s = Math.max(w / sw, h / sh) * zoom
    ctx.drawImage(el, (w - sw * s) / 2 + dx, (h - sh * s) / 2 + dy, sw * s, sh * s)
  }

  function activeIndex(pos: number): number {
    let a = -1
    for (let i = 0; i < inp.lines.length; i++) if (pos >= inp.lines[i]!.timeMs) a = i
    return a
  }

  function draw(ctx: CanvasRenderingContext2D, posMs: number, t: number): void {
    const dt = Math.min(0.1, Math.max(0, t - lastT))
    lastT = t

    // ---- background
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, inp.tint1)
    g.addColorStop(1, inp.tint2)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    const m = inp.media
    const sb = inp.stage?.bitmap
    if (sb) {
      const c = inp.stage?.crop ?? { t: 0, r: 0, b: 0, l: 0 }
      const sx = c.l * sb.width
      const sy = c.t * sb.height
      const sw = sb.width * (1 - c.l - c.r)
      const sh = sb.height * (1 - c.t - c.b)
      const k = Math.max(w / sw, h / sh)
      ctx.drawImage(sb, sx, sy, sw, sh, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k)
    } else if (m instanceof HTMLVideoElement && m.readyState >= 2 && m.videoWidth) cover(ctx, m, m.videoWidth, m.videoHeight)
    else if (m instanceof HTMLImageElement && m.naturalWidth) cover(ctx, m, m.naturalWidth, m.naturalHeight, 1.04 + Math.sin(t / 12) * 0.02, Math.sin(t / 9) * base * 0.01, Math.cos(t / 11) * base * 0.01)
    else if (blurred) cover(ctx, blurred, blurred.width, blurred.height, 1.1 + Math.sin(t / 10) * 0.05, Math.sin(t / 7) * w * 0.03, Math.cos(t / 8) * h * 0.03)
    const veil = ctx.createLinearGradient(0, 0, 0, h)
    const hasMedia = !!m || !!sb
    // light at the top so the picture shows, darker towards the lyrics and the song at the bottom
    veil.addColorStop(0, `rgba(0,0,0,${hasMedia ? 0.12 : 0.1})`)
    veil.addColorStop(0.28, `rgba(0,0,0,${hasMedia ? 0.04 : 0.08})`)
    veil.addColorStop(0.58, `rgba(0,0,0,${hasMedia ? 0.4 : 0.34})`)
    veil.addColorStop(1, `rgba(0,0,0,${hasMedia ? 0.78 : 0.7})`)
    ctx.fillStyle = veil
    ctx.fillRect(0, 0, w, h)
    // a soft dark band behind the lyrics so white text stays readable on any picture (bright faces, white walls)
    if (hasMedia && portrait) {
      const band = ctx.createLinearGradient(0, h * 0.28, 0, h * 0.72)
      band.addColorStop(0, 'rgba(0,0,0,0)')
      band.addColorStop(0.5, 'rgba(0,0,0,0.24)')
      band.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = band
      ctx.fillRect(0, h * 0.28, w, h * 0.44)
    }

    // ---- lyrics
    const idx = activeIndex(posMs)
    const focusY = h * (inp.position === 'upper' ? 0.3 : inp.position === 'lower' ? 0.6 : tall ? 0.46 : portrait ? 0.5 : 0.44)
    if (placed.length) {
      const target = Math.max(0, idx)
      scroll += (target - scroll) * (1 - Math.exp(-dt / 0.2))
      const lo = Math.floor(scroll)
      const hi = Math.min(placed.length - 1, lo + 1)
      const frac = scroll - lo
      const topNow = placed[lo]!.top + (placed[hi]!.top - placed[lo]!.top) * frac
      ctx.textBaseline = 'top'
      ctx.font = `800 ${fontSize}px ${inp.fontFamily}`
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i]!
        const yy = focusY + (p.top - topNow)
        if (yy > h + lineH || yy + p.height < -lineH) continue
        const d = i - scroll
        const isNow = i === idx
        if (inp.style === 'focus' && i !== idx && i !== idx + 1) continue
        if (inp.style === 'subtitle' && i !== idx) continue
        // fade near the top and above the song bar so the text never runs into it
        const mid = yy + p.height / 2
        const edge = Math.max(0, Math.min(1, Math.min((mid - h * (tall ? 0.19 : 0.05)) / (h * 0.12), (h * (tall ? (inp.showSong ? 0.66 : 0.76) : inp.showSong ? 0.8 : 0.9) - mid) / (h * 0.12))))
        // the current line is bright; the ones around it step down quickly (like Lyra on the phone) so the picture stays clear
        const ring = isNow ? 0 : Math.max(1, Math.min(3, Math.round(Math.abs(d))))
        const alpha = (isNow ? 1 : inp.style === 'scroll' ? [1, 0.5, 0.22, 0][ring]! : 0.3) * edge
        if (alpha <= 0.01) continue
        const sc = isNow ? 1 : inp.style === 'scroll' ? [1, 0.86, 0.78, 0.74][ring]! : 0.92
        ctx.save()
        ctx.translate(colX, yy)
        ctx.scale(sc, sc)
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowBlur = fontSize * 0.3
        p.rows.forEach((row, r) => {
          let x = centered ? Math.max(0, (colW / sc - p.rowWidths[r]!) / 2) : 0
          const ry = r * lineH
          for (const wi of row) {
            const wd = p.words[wi]!
            const ww = measure.measureText(wd.text).width
            ctx.fillStyle = `rgba(255,255,255,${isNow ? 0.34 * edge : alpha})`
            ctx.fillText(wd.text, x, ry)
            if (isNow) {
              const next = p.words[wi + 1]?.timeMs ?? inp.lines[i]!.endMs ?? (inp.lines[i + 1]?.timeMs ?? inp.lines[i]!.timeMs + 4000)
              const start = wd.timeMs ?? inp.lines[i]!.timeMs
              const prog = wd.timeMs === null ? (posMs >= start ? 1 : 0) : Math.min(1, Math.max(0, (posMs - start) / Math.max(1, next - start)))
              if (prog > 0) {
                ctx.save()
                ctx.beginPath()
                ctx.rect(x, ry - 4, ww * prog + 1, lineH + 8)
                ctx.clip()
                ctx.globalAlpha = edge
                ctx.fillStyle = inp.fill
                ctx.fillText(wd.text, x, ry)
                ctx.restore()
              }
            }
            x += ww + space
          }
        })
        if (p.roman.length) {
          ctx.font = `600 ${romanSize}px ${inp.fontFamily}`
          ctx.fillStyle = `rgba(255,255,255,${(isNow ? 0.82 : Math.min(0.7, alpha + 0.12)) * edge})`
          p.roman.forEach((row, r) => {
            const rw = ctx.measureText(row).width
            const rx = centered ? Math.max(0, (colW / sc - rw) / 2) : 0
            ctx.fillText(row, rx, p.rows.length * lineH + romanGap + r * romanLineH)
          })
          ctx.font = `800 ${fontSize}px ${inp.fontFamily}`
        }
        ctx.restore()
      }
      ctx.shadowBlur = 0
    }

    // ---- song
    if (inp.showSong) {
      const cs = Math.round(base * 0.085)
      const sy = tall ? h * 0.775 - cs : portrait || w === h ? h - margin * 0.7 - base * 0.05 - base * 0.035 - cs : h - margin - cs
      const sx = margin
      if (inp.art) {
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(sx, sy, cs, cs, cs * 0.2)
        ctx.clip()
        ctx.drawImage(inp.art, sx, sy, cs, cs)
        ctx.restore()
      }
      const tx = sx + (inp.art ? cs + base * 0.026 : 0)
      const maxW = (portrait ? w - margin - (tall ? w * 0.1 : 0) : colX - margin * 0.5) - tx
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#fff'
      ctx.font = `700 ${Math.round(cs * 0.34)}px ${inp.fontFamily}`
      ctx.fillText(fit(ctx, inp.title, maxW), tx, sy + cs * 0.1)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `500 ${Math.round(cs * 0.28)}px ${inp.fontFamily}`
      ctx.fillText(fit(ctx, inp.artist, maxW), tx, sy + cs * 0.55)
    }

    // ---- "Made with Lyra ♥": a small, quiet badge at the bottom (bottom right in wide videos)
    {
      const bh = base * 0.045
      const f1 = `800 ${Math.round(bh * 0.4)}px ${inp.fontFamily}`
      const f2 = `600 ${Math.round(bh * 0.27)}px ${inp.fontFamily}`
      const t1 = 'Made with Lyra'
      const t2 = 'Free lyric videos · lyra-website-rho.vercel.app'
      ctx.font = f1
      const w1 = ctx.measureText(t1).width
      const heartW = ctx.measureText(' ♥').width
      ctx.font = f2
      const w2 = ctx.measureText(t2).width
      const iconS = bh * 0.9
      const pad = bh * 0.28
      const textW = Math.max(w1 + heartW, w2)
      const bw = pad * 2 + iconS + pad * 0.8 + textW
      const bhh = bh * 1.12
      const bx = portrait || w === h ? (w - bw) / 2 : w - margin - bw
      const by = tall ? h * 0.12 : h - margin * 0.7 - bhh
      ctx.save()
      ctx.globalAlpha = 0.9
      ctx.fillStyle = 'rgba(12,12,16,0.6)'
      ctx.beginPath()
      ctx.roundRect(bx, by, bw, bhh, bhh / 2)
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, bh * 0.03)
      const edge = ctx.createLinearGradient(bx, by, bx + bw, by + bhh)
      edge.addColorStop(0, 'rgba(255,122,89,0.9)')
      edge.addColorStop(0.5, 'rgba(198,76,255,0.9)')
      edge.addColorStop(1, 'rgba(63,208,255,0.9)')
      ctx.strokeStyle = edge
      ctx.stroke()
      if (inp.logo?.naturalWidth) {
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(bx + pad, by + (bhh - iconS) / 2, iconS, iconS, iconS * 0.24)
        ctx.clip()
        ctx.drawImage(inp.logo, bx + pad, by + (bhh - iconS) / 2, iconS, iconS)
        ctx.restore()
      }
      const tx = bx + pad + iconS + pad * 0.8
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#ffffff'
      ctx.font = f1
      ctx.fillText(t1, tx, by + bhh * 0.46)
      const pulse = 1 + 0.14 * Math.max(0, Math.sin(t * 4))
      ctx.save()
      ctx.translate(tx + w1 + heartW * 0.5, by + bhh * 0.46 - bh * 0.13)
      ctx.scale(pulse, pulse)
      ctx.fillStyle = '#ff4d6d'
      ctx.textAlign = 'center'
      ctx.fillText('♥', 0, bh * 0.13)
      ctx.restore()
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(255,255,255,0.72)'
      ctx.font = f2
      ctx.fillText(t2, tx, by + bhh * 0.8)
      ctx.restore()
    }

    // ---- thin progress line
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(0, h - 5, w, 5)
  }

  /** The closing card: a few seconds of black with the Lyra logo and an invitation to make a video like this. */
  function endCard(ctx: CanvasRenderingContext2D, k: number, t: number): void {
    const ease = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
    ctx.fillStyle = '#050505'
    ctx.fillRect(0, 0, w, h)
    // a soft glow in the three Lyra colours behind the logo
    const cx = w / 2
    const cy = h * 0.46
    const R = base * 0.75
    for (const [dx, dy, col] of [[-0.18, -0.1, 'rgba(255,122,89,0.34)'], [0.2, 0.0, 'rgba(198,76,255,0.34)'], [0, 0.2, 'rgba(63,208,255,0.3)']] as Array<[number, number, string]>) {
      const g = ctx.createRadialGradient(cx + dx * R, cy + dy * R, 0, cx + dx * R, cy + dy * R, R * 0.9)
      g.addColorStop(0, col)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = ease(k * 2)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    ctx.globalAlpha = 1
    const logoS = base * 0.2 * (0.82 + 0.18 * ease(k * 2.2))
    ctx.save()
    ctx.globalAlpha = ease(k * 2.2)
    if (inp.logo?.naturalWidth) {
      ctx.shadowColor = 'rgba(198,76,255,0.6)'
      ctx.shadowBlur = base * 0.06
      ctx.beginPath()
      ctx.roundRect(cx - logoS / 2, cy - logoS * 0.9, logoS, logoS, logoS * 0.24)
      ctx.clip()
      ctx.drawImage(inp.logo, cx - logoS / 2, cy - logoS * 0.9, logoS, logoS)
    }
    ctx.restore()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const line = (text: string, size: number, weight: number, y: number, alpha: number, color = '#ffffff'): void => {
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.font = `${weight} ${Math.round(size)}px ${inp.fontFamily}`
      ctx.fillText(text, cx, y)
    }
    line('Make lyric videos like this', base * 0.058, 800, cy + base * 0.17, ease(k * 2 - 0.4))
    line('Download Lyra, free', base * 0.044, 700, cy + base * 0.255, ease(k * 2 - 0.7), '#ffd5a8')
    line('lyra-website-rho.vercel.app', base * 0.034, 600, cy + base * 0.33, ease(k * 2 - 0.9) * 0.8, '#a9d7ff')
    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
    void t
  }

  return { draw, endCard }
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}
