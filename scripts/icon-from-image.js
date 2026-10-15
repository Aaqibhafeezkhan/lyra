// Builds build/icon.ico, build/icon.png and resources/icon.png from build/logo-source.webp.
// Run with Electron (it can decode WebP and has a canvas): npx electron scripts/icon-from-image.js
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const SOURCE = path.join(root, 'build', 'logo-source.webp')

// Crop of the glass tile inside the 1254x1254 source (tile + hairline glow), and its corner radius.
const CROP = { cx: 613, cy: 589, side: 812, radius: 168 }
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

function ico(entries) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(entries.length, 4)
  let offset = 6 + entries.length * 16
  const dir = entries.map((e) => {
    const d = Buffer.alloc(16)
    d[0] = e.size >= 256 ? 0 : e.size
    d[1] = e.size >= 256 ? 0 : e.size
    d.writeUInt16LE(1, 4)
    d.writeUInt16LE(32, 6)
    d.writeUInt32LE(e.data.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += e.data.length
    return d
  })
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('about:blank')
  const dataUrl = 'data:image/webp;base64,' + fs.readFileSync(SOURCE).toString('base64')
  const pngs = await win.webContents.executeJavaScript(`
    (async () => {
      const img = new Image()
      img.src = ${JSON.stringify(dataUrl)}
      await img.decode()
      const c = ${JSON.stringify(CROP)}
      const out = {}
      for (const size of ${JSON.stringify(SIZES)}) {
        // step down in halves for a cleaner small-size result than one big resample
        let cur = document.createElement('canvas')
        cur.width = cur.height = c.side
        let ctx = cur.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.beginPath()
        ctx.roundRect(0, 0, c.side, c.side, c.radius)
        ctx.clip()
        ctx.drawImage(img, c.cx - c.side / 2, c.cy - c.side / 2, c.side, c.side, 0, 0, c.side, c.side)
        while (cur.width / 2 >= size) {
          const next = document.createElement('canvas')
          next.width = next.height = Math.max(size, Math.round(cur.width / 2))
          const nctx = next.getContext('2d')
          nctx.imageSmoothingQuality = 'high'
          nctx.drawImage(cur, 0, 0, next.width, next.height)
          cur = next
        }
        const fin = document.createElement('canvas')
        fin.width = fin.height = size
        const fctx = fin.getContext('2d')
        fctx.imageSmoothingQuality = 'high'
        fctx.drawImage(cur, 0, 0, size, size)
        out[size] = fin.toDataURL('image/png')
      }
      return out
    })()
  `)
  const buf = (size) => Buffer.from(pngs[size].split(',')[1], 'base64')
  fs.mkdirSync(path.join(root, 'build'), { recursive: true })
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), buf(512))
  fs.writeFileSync(path.join(root, 'resources', 'icon.png'), buf(512))
  fs.writeFileSync(
    path.join(root, 'build', 'icon.ico'),
    ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: buf(size) })))
  )
  console.log('icons written from', SOURCE)
  app.quit()
})
