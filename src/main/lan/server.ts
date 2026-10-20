import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { PlaybackSnapshot, Track } from '@shared/types'
import { lyricsService } from '@core/lyrics/service'
import { createLogger } from '../logger'
import { settings } from '../settings'
import { VIEWER_HTML } from './viewerHtml'

const log = createLogger('lan')

/**
 * TV / party mode: a tiny read-only web server on the local network. Anyone with the link (and its secret key)
 * can open the viewer page on a phone, laptop or TV browser and see the current song's synced lyrics.
 * Off by default. It serves only what is playing: no files, no settings, no account data.
 */
class LanViewer {
  private server: Server | null = null
  private clients = new Set<ServerResponse>()
  private snap: PlaybackSnapshot | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private port = 0
  /** Set by ipc.ts: hands a guest's WebRTC offer to the app window and resolves with its answer. */
  onOffer: ((offer: unknown) => Promise<unknown>) | null = null

  /** Secret that has to be in every request (stops other people on the same Wi-Fi from stumbling in). */
  get token(): string {
    let t = settings.get().lanToken
    if (!t) {
      t = randomBytes(6).toString('hex')
      settings.update({ lanToken: t })
    }
    return t
  }

  get running(): boolean {
    return !!this.server
  }

  get currentPort(): number {
    return this.port
  }

  /** Links this PC is reachable at, most likely first. */
  urls(): string[] {
    if (!this.server) return []
    const out: string[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list ?? []) {
        if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${this.port}/?k=${this.token}`)
      }
    }
    // private Wi-Fi / LAN ranges first
    return out.sort((a, b) => Number(/\/\/(192\.168|10\.)/.test(b)) - Number(/\/\/(192\.168|10\.)/.test(a)))
  }

  start(): void {
    if (this.server) return
    const want = settings.get().lanPort
    const srv = createServer((req, res) => this.handle(req, res))
    srv.on('error', (e: NodeJS.ErrnoException) => {
      log.warn('could not start', e.message)
      if (e.code === 'EADDRINUSE' && this.port !== 0) return
      // port taken: let the OS pick one
      this.server = null
      this.listen(srv, 0)
    })
    this.server = srv
    this.listen(srv, want)
  }

  private listen(srv: Server, port: number): void {
    srv.listen(port, '0.0.0.0', () => {
      this.port = (srv.address() as { port: number }).port
      this.server = srv
      log.info('viewer on port', this.port)
      this.heartbeat = setInterval(() => this.broadcast(), 4000)
    })
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const c of this.clients) c.end()
    this.clients.clear()
    this.server?.close()
    this.server = null
    this.port = 0
  }

  publish(s: PlaybackSnapshot): void {
    this.snap = s
    if (this.server) this.broadcast()
  }

  private state(): Record<string, unknown> {
    const s = this.snap
    const t = s?.track
    return {
      type: 'state',
      now: Date.now(),
      trackId: t?.id ?? '',
      title: t?.title ?? '',
      artists: t?.artists.join(', ') ?? '',
      durationMs: t?.durationMs ?? 0,
      hasArt: !!t?.artworkUrl,
      playing: !!s?.isPlaying,
      positionMs: s?.positionMs ?? 0,
      sampledAt: s?.sampledAt ?? Date.now()
    }
  }

  private broadcast(): void {
    if (this.clients.size === 0) return
    const data = `data: ${JSON.stringify(this.state())}\n\n`
    for (const c of this.clients) c.write(data)
  }

  private handleOffer(req: IncomingMessage, res: ServerResponse, common: Record<string, string>): void {
    const fail = (code: number, msg: string): void => {
      res.writeHead(code, { ...common, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: msg }))
    }
    if (!settings.get().lanAudio || !this.onOffer) return fail(403, 'Sound sharing is off in Lyra (Settings → Share).')
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c
      if (body.length > 100_000) req.destroy()
    })
    req.on('end', () => {
      let offer: unknown
      try {
        offer = JSON.parse(body)
      } catch {
        return fail(400, 'Bad request')
      }
      this.onOffer!(offer)
        .then((answer) => {
          if (!answer) return fail(503, 'Lyra could not start the sound stream.')
          res.writeHead(200, { ...common, 'Content-Type': 'application/json' })
          res.end(JSON.stringify(answer))
        })
        .catch(() => fail(503, 'Lyra could not start the sound stream.'))
    })
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x')
    // the key can come as ?k= or as a cookie set by the first visit (so the page can load its sub-requests)
    if (url.searchParams.get('k') !== this.token) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Open the link shown in Lyra (Settings → TV & party mode).')
      return
    }
    const common = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    if (url.pathname === '/rtc/offer' && req.method === 'POST') {
      this.handleOffer(req, res, common)
      return
    }
    if (url.pathname === '/') {
      res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob: data:" })
      res.end(VIEWER_HTML)
    } else if (url.pathname === '/events') {
      res.writeHead(200, { ...common, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify(this.state())}\n\n`)
      this.clients.add(res)
      req.on('close', () => this.clients.delete(res))
    } else if (url.pathname === '/lyrics') {
      const t = this.snap?.track
      if (!t) {
        res.writeHead(200, { ...common, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'none', lines: [] }))
        return
      }
      lyricsService
        .get(t as Track)
        .then((r) => {
          res.writeHead(200, { ...common, 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: r.status, lines: r.lines.map((l) => ({ timeMs: l.timeMs, text: l.text })) }))
        })
        .catch(() => {
          res.writeHead(200, { ...common, 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'error', lines: [] }))
        })
    } else if (url.pathname === '/art') {
      const a = this.snap?.track?.artworkUrl
      const m = a ? /^data:([^;]+);base64,(.*)$/s.exec(a) : null
      if (m) {
        res.writeHead(200, { ...common, 'Content-Type': m[1]!, 'Cache-Control': 'max-age=3600' })
        res.end(Buffer.from(m[2]!, 'base64'))
      } else if (a && /^https:\/\//.test(a)) {
        res.writeHead(302, { Location: a })
        res.end()
      } else {
        res.writeHead(404)
        res.end()
      }
    } else {
      res.writeHead(404)
      res.end()
    }
  }
}

export const lanViewer = new LanViewer()
