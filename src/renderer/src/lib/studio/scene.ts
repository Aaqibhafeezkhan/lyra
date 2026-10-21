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
  /** a looping video or a photo behind the lyrics; null = the cover's colours */
  media: HTMLVideoElement | HTMLImageElement | null
  logo: HTMLImageElement | null
  accent: string
  tint1: string
  tint2: string
  showSong: boolean
  fontFamily: string
  /** length of the song in ms (the badge turns into a call to action near the end) */
  totalMs: number
}

interface Placed {
  words: Array<{ text: string; timeMs: number | null }>
  rows: Array<Array<number>> // indexes into words, per wrapped row
  rowWidths: number[]
  top: number
  height: number
}

export interface Scene {
  draw(ctx: CanvasRenderingContext2D, posMs: number, tSec: number): void
}

export function createScene(inp: SceneInput): Scene {
  const { w, h } = inp
  const base = Math.min(w, h)
  const portrait = h >= w
  const margin = Math.round(base * (portrait ? 0.085 : 0.07))
  const fontSize = Math.round(base * (portrait ? 0.074 : 0.078))
  const lineH = Math.round(fontSize * 1.18)
  const gap = Math.round(fontSize * 0.55)
  // lyrics column: the whole width in portrait/square, the right 62% in landscape (the song sits left)
  const colX = portrait ? margin : Math.round(w * 0.36)
  const colW = w - colX - margin
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
    const height = Math.max(1, rows.length) * lineH
    placed.push({ words, rows, rowWidths, top: y, height })
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
    if (m instanceof HTMLVideoElement && m.readyState >= 2 && m.videoWidth) cover(ctx, m, m.videoWidth, m.videoHeight)
    else if (m instanceof HTMLImageElement && m.naturalWidth) cover(ctx, m, m.naturalWidth, m.naturalHeight, 1.04 + Math.sin(t / 12) * 0.02, Math.sin(t / 9) * base * 0.01, Math.cos(t / 11) * base * 0.01)
    else if (blurred) cover(ctx, blurred, blurred.width, blurred.height, 1.1 + Math.sin(t / 10) * 0.05, Math.sin(t / 7) * w * 0.03, Math.cos(t / 8) * h * 0.03)
    const veil = ctx.createLinearGradient(0, 0, 0, h)
    veil.addColorStop(0, `rgba(0,0,0,${m ? 0.38 : 0.18})`)
    veil.addColorStop(0.5, `rgba(0,0,0,${m ? 0.46 : 0.26})`)
    veil.addColorStop(1, `rgba(0,0,0,${m ? 0.72 : 0.6})`)
    ctx.fillStyle = veil
    ctx.fillRect(0, 0, w, h)

    // ---- lyrics
    const idx = activeIndex(posMs)
    const focusY = h * (portrait ? 0.4 : 0.42)
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
        // fade near the top and above the song bar so the text never runs into it
        const mid = yy + p.height / 2
        const edge = Math.max(0, Math.min(1, Math.min((mid - h * 0.05) / (h * 0.12), (h * (inp.showSong ? 0.8 : 0.9) - mid) / (h * 0.12))))
        const alpha = (isNow ? 1 : Math.max(0.12, 0.42 - Math.abs(d) * 0.08)) * edge
        if (alpha <= 0.01) continue
        const sc = isNow ? 1 : 0.92
        ctx.save()
        ctx.translate(colX, yy)
        ctx.scale(sc, sc)
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowBlur = fontSize * 0.3
        p.rows.forEach((row, r) => {
          let x = 0
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
                ctx.fillStyle = `rgba(255,255,255,${edge})`
                ctx.fillText(wd.text, x, ry)
                ctx.restore()
              }
            }
            x += ww + space
          }
        })
        ctx.restore()
      }
      ctx.shadowBlur = 0
    }

    // ---- song
    if (inp.showSong) {
      const cs = Math.round(base * 0.085)
      const sy = h - margin - cs - (portrait ? Math.round(h * 0.035) : 0)
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
      const maxW = (portrait ? w - margin : colX - margin * 0.5) - tx
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#fff'
      ctx.font = `700 ${Math.round(cs * 0.34)}px ${inp.fontFamily}`
      ctx.fillText(fit(ctx, inp.title, maxW), tx, sy + cs * 0.1)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `500 ${Math.round(cs * 0.28)}px ${inp.fontFamily}`
      ctx.fillText(fit(ctx, inp.artist, maxW), tx, sy + cs * 0.55)
    }

    // ---- "Made with Lyra ♥": a fixed, tasteful badge (top centre in tall videos, bottom right in wide ones).
    // In the last seconds it grows into a small call to action.
    {
      const endIn = inp.totalMs > 0 ? Math.min(1, Math.max(0, (posMs - (inp.totalMs - 4500)) / 900)) : 0
      const ease = endIn * endIn * (3 - 2 * endIn)
      const bh = base * 0.062 * (1 + 0.55 * ease)
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
      let bx: number
      let by: number
      if (portrait || w === h) {
        bx = (w - bw) / 2 - ease * 0
        by = h * 0.085 + ease * (h * 0.1)
      } else {
        bx = w - margin - bw
        by = h - margin - bhh - ease * (h * 0.25)
      }
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = bh * 0.5
      ctx.fillStyle = 'rgba(12,12,16,0.62)'
      ctx.beginPath()
      ctx.roundRect(bx, by, bw, bhh, bhh / 2)
      ctx.fill()
      ctx.shadowBlur = 0
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

  return { draw }
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}
