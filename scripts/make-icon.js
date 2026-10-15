// Generates the app icon (no external tools): build/icon.png (512) and build/icon.ico (16-256).
// Run: node scripts/make-icon.js
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SS = 4 // supersampling per axis

const mix = (a, b, t) => a + (b - a) * t
const clamp01 = (x) => Math.min(1, Math.max(0, x))

function sdfRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.max(Math.abs(x - cx) - (hw - r), 0)
  const dy = Math.max(Math.abs(y - cy) - (hh - r), 0)
  return Math.hypot(dx, dy) - r
}

/** Vertical capsule (rounded bar). */
function sdfBar(x, y, cx, cy, halfW, halfH) {
  return sdfRoundRect(x, y, cx, cy, halfW, halfH, halfW)
}

const BARS = [
  { cx: 0.31, h: 0.3 },
  { cx: 0.5, h: 0.54 },
  { cx: 0.69, h: 0.4 }
]

/** Colour (rgb 0-255) and coverage (0-1) of the icon at normalised point (u, v). */
function sample(u, v) {
  const d = sdfRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.225)
  if (d > 0) return null

  // deep charcoal gradient
  const t = clamp01((u * 0.6 + v * 0.9) / 1.5)
  let r = mix(38, 11, t)
  let g = mix(38, 11, t)
  let b = mix(46, 13, t)

  // soft "glass" light from the top-left
  const hl = clamp01(1 - Math.hypot(u - 0.22, v - 0.12) / 0.75)
  const add = 34 * hl * hl
  r += add
  g += add
  b += add * 1.08

  // hairline inner border
  if (d > -0.014) {
    const k = 0.14 * (1 - (-d) / 0.014)
    r = mix(r, 255, k)
    g = mix(g, 255, k)
    b = mix(b, 255, k)
  }

  // three lyric/equaliser bars, white -> pale lavender
  for (const bar of BARS) {
    const bd = sdfBar(u, v, bar.cx, 0.5, 0.062, bar.h / 2)
    if (bd <= 0) {
      const k = clamp01((v - (0.5 - bar.h / 2)) / bar.h)
      r = mix(255, 196, k)
      g = mix(255, 202, k)
      b = mix(255, 255, k)
    }
  }
  return [r, g, b]
}

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, cov = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
          if (c) {
            ar += c[0]; ag += c[1]; ab += c[2]; cov++
          }
        }
      }
      const i = (y * size + x) * 4
      if (cov > 0) {
        px[i] = Math.round(ar / cov)
        px[i + 1] = Math.round(ag / cov)
        px[i + 2] = Math.round(ab / cov)
        px[i + 3] = Math.round((cov / (SS * SS)) * 255)
      }
    }
  }
  return px
}

// ---- PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---- ICO container (PNG-compressed entries) ----
function ico(entries) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(entries.length, 4)
  let offset = 6 + entries.length * 16
  const dir = []
  for (const e of entries) {
    const d = Buffer.alloc(16)
    d[0] = e.size >= 256 ? 0 : e.size
    d[1] = e.size >= 256 ? 0 : e.size
    d.writeUInt16LE(1, 4)
    d.writeUInt16LE(32, 6)
    d.writeUInt32LE(e.data.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += e.data.length
    dir.push(d)
  }
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.data)])
}

const root = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.mkdirSync(path.join(root, 'resources'), { recursive: true })

const big = png(512, render(512))
fs.writeFileSync(path.join(root, 'build', 'icon.png'), big)
fs.writeFileSync(path.join(root, 'resources', 'icon.png'), big)
fs.writeFileSync(
  path.join(root, 'build', 'icon.ico'),
  ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(size, render(size)) })))
)
console.log('icons written to build/ and resources/')
