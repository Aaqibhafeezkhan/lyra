import { BrowserWindow, app, dialog, net, protocol } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BackgroundMedia, BackgroundResolution, BackgroundSpec, Track, YoutubeVideo } from '@shared/types'
import { JsonStore } from '../jsonStore'
import { createLogger } from '../logger'
import { settings } from '../settings'
import { HOST_RE, itunes } from './itunes'
import { thumbCrop } from './thumbcrop'
import { youtube } from './youtube'

const log = createLogger('background')

export const BG_SCHEME = 'lyra-media'
const MAX_BYTES = 200 * 1024 * 1024
const VIDEO = new Set(['.mp4', '.webm'])
const IMAGE = new Set(['.gif', '.png', '.jpg', '.jpeg', '.webp', '.apng'])
const NAME_RE = /^[a-f0-9]{16}\.(mp4|webm|gif|png|jpe?g|webp|apng)$/i

interface SongBg {
  media?: BackgroundMedia
  youtube?: YoutubeVideo
}

/** Must run before app is ready. */
export function registerBackgroundScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: BG_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])
}

class BackgroundService {
  private store: JsonStore<{ songs: Record<string, SongBg> }> | null = null

  private get dir(): string {
    const d = join(app.getPath('userData'), 'backgrounds')
    mkdirSync(d, { recursive: true })
    return d
  }
  private songs(): Record<string, SongBg> {
    return (this.store ??= new JsonStore<{ songs: Record<string, SongBg> }>('backgrounds.json', { songs: {} })).get().songs
  }
  private save(songs: Record<string, SongBg>): void {
    this.store!.set({ songs })
  }

  /**
   * lyra-media://bg/<hash>.<ext>   -> a file Lyra copied into userData/backgrounds
   * lyra-media://preview/<base64url> -> a streamed (never stored) Apple preview clip, host-checked
   * Both answer with CORS headers so the renderer may read frames (brightness / letterbox detection).
   */
  registerProtocol(): void {
    const cors = (res: Response): Response => {
      const h = new Headers()
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = res.headers.get(k)
        if (v) h.set(k, v)
      }
      h.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, headers: h })
    }
    const range = (req: Request): Record<string, string> => {
      const r = req.headers.get('range')
      return r ? { range: r } : {}
    }
    protocol.handle(BG_SCHEME, async (req) => {
      try {
        const u = new URL(req.url)
        const name = decodeURIComponent(u.pathname.replace(/^\//, ''))
        if (u.hostname === 'bg') {
          if (!NAME_RE.test(name)) return new Response('not found', { status: 404 })
          const file = join(this.dir, name)
          if (!existsSync(file)) return new Response('not found', { status: 404 })
          return cors(await net.fetch(pathToFileURL(file).toString(), { headers: range(req) }))
        }
        if (u.hostname === 'preview') {
          const target = Buffer.from(name, 'base64url').toString('utf8')
          if (!HOST_RE.test(target)) return new Response('forbidden', { status: 403 })
          return cors(await net.fetch(target, { headers: range(req) }))
        }
        return new Response('not found', { status: 404 })
      } catch {
        return new Response('bad request', { status: 400 })
      }
    })
  }

  private mediaSpec(m: BackgroundMedia, scope: 'song' | 'global'): BackgroundSpec | null {
    if (!NAME_RE.test(m.file) || !existsSync(join(this.dir, m.file))) return null
    return { kind: 'media', url: `${BG_SCHEME}://bg/${m.file}`, media: m.kind, name: m.name, scope }
  }

  async resolve(track: Track): Promise<BackgroundResolution> {
    const s = settings.get()
    const song = this.songs()[track.id]
    const songSpec = song?.media ? this.mediaSpec(song.media, 'song') : null
    const globalSpec = s.customBackground ? this.mediaSpec(s.customBackground, 'global') : null
    const base = { hasSongMedia: !!songSpec, hasGlobalMedia: !!globalSpec }
    const living: BackgroundSpec = { kind: 'living' }
    const ytSpec = async (v: YoutubeVideo, scope: 'song' | 'auto'): Promise<BackgroundSpec> => ({ kind: 'youtube', videoId: v.videoId, title: v.title, channel: v.channel, durationSec: v.durationSec, crop: await thumbCrop(v.videoId), scope })

    if (s.backgroundStyle === 'still') return { ...base, spec: { kind: 'still' }, youtube: 'off' }
    if (s.backgroundStyle === 'living') return { ...base, spec: living, youtube: 'off' }
    if (s.backgroundStyle === 'custom') return { ...base, spec: songSpec ?? globalSpec ?? living, youtube: 'off' }

    // pinned choices first: the user's own file for this song (auto), or the video they picked for it
    if (s.backgroundStyle === 'auto' && songSpec) return { ...base, spec: songSpec, youtube: song?.youtube ? 'pinned' : 'off' }
    if (song?.youtube) return { ...base, spec: await ytSpec(song.youtube, 'song'), youtube: 'pinned' }

    const asClip = async (): Promise<BackgroundSpec | null> => {
      const clip = await itunes.find(track)
      return clip ? { kind: 'preview', url: `${BG_SCHEME}://preview/${Buffer.from(clip.url).toString('base64url')}`, title: clip.title } : null
    }
    const yt = (): ReturnType<typeof youtube.find> => youtube.find(track)
    const report = (r: Awaited<ReturnType<typeof youtube.find>>): Pick<BackgroundResolution, 'youtube' | 'youtubeMessage'> =>
      r.state === 'error' ? { youtube: 'error', youtubeMessage: r.message } : { youtube: r.state === 'found' ? 'found' : r.state }

    if (s.backgroundStyle === 'youtube') {
      // "Video": YouTube first, then Apple's clip, then your file, then living artwork
      const r = await yt()
      if (r.state === 'found') return { ...base, spec: await ytSpec(r.video, 'auto'), youtube: 'found' }
      return { ...base, spec: (await asClip()) ?? globalSpec ?? living, ...report(r) }
    }

    // Auto: your global file -> free Apple clip -> YouTube (only with a key) -> living artwork
    if (globalSpec) return { ...base, spec: globalSpec, youtube: youtube.hasKey() ? 'off' : 'no-key' }
    const clip = await asClip()
    if (clip) return { ...base, spec: clip, youtube: youtube.hasKey() ? 'off' : 'no-key' }
    const r = await yt()
    if (r.state === 'found') return { ...base, spec: await ytSpec(r.video, 'auto'), youtube: 'found' }
    return { ...base, spec: living, ...report(r) }
  }

  /** Let the user choose a file; it is COPIED into Lyra's own folder (nothing outside it is ever read later). */
  async pick(scope: 'song' | 'global', trackId?: string): Promise<{ ok: boolean; error?: string }> {
    const win = BrowserWindow.getAllWindows()[0]
    const opts: Electron.OpenDialogOptions = {
      title: scope === 'song' ? 'Choose a background for this song' : 'Choose a background for all songs',
      properties: ['openFile'],
      filters: [{ name: 'Images, GIFs & video', extensions: ['mp4', 'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { ok: false }
    return this.importFile(r.filePaths[0], scope, trackId)
  }

  async importFile(path: string, scope: 'song' | 'global', trackId?: string): Promise<{ ok: boolean; error?: string }> {
    const ext = extname(path).toLowerCase()
    const kind = VIDEO.has(ext) ? 'video' : IMAGE.has(ext) ? 'image' : null
    if (!kind) return { ok: false, error: 'Use an MP4, WebM, GIF, PNG, JPG or WebP file.' }
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return { ok: false, error: 'Couldn’t read that file.' }
    }
    if (size > MAX_BYTES) return { ok: false, error: `That file is ${Math.round(size / 1048576)} MB. The limit is 200 MB.` }
    if (scope === 'song' && !trackId) return { ok: false, error: 'No song selected.' }

    const hash = createHash('sha256')
    await new Promise<void>((res, rej) => createReadStream(path).on('data', (c) => hash.update(c)).on('end', () => res()).on('error', rej))
    const file = `${hash.digest('hex').slice(0, 16)}${ext === '.jpeg' ? '.jpg' : ext}`
    if (!existsSync(join(this.dir, file))) copyFileSync(path, join(this.dir, file))
    const media: BackgroundMedia = { file, name: path.split(/[\\/]/).pop()!.slice(0, 120), kind }

    if (scope === 'global') settings.update({ customBackground: media })
    else {
      const songs = this.songs()
      songs[trackId!] = { ...songs[trackId!], media }
      this.save(songs)
    }
    this.collectGarbage()
    return { ok: true }
  }

  clear(scope: 'song' | 'global', trackId?: string): void {
    if (scope === 'global') settings.update({ customBackground: null })
    else if (trackId) {
      const songs = this.songs()
      if (songs[trackId]) {
        delete songs[trackId]!.media
        if (!songs[trackId]!.youtube) delete songs[trackId]
        this.save(songs)
      }
    }
    this.collectGarbage()
  }

  chooseYoutube(trackId: string, video: YoutubeVideo | null): void {
    const songs = this.songs()
    if (video) songs[trackId] = { ...songs[trackId], youtube: video }
    else if (songs[trackId]) {
      delete songs[trackId]!.youtube
      if (!songs[trackId]!.media) delete songs[trackId]
    }
    this.save(songs)
  }

  /** Delete copied files nothing refers to any more. */
  collectGarbage(): void {
    try {
      const used = new Set<string>()
      const g = settings.get().customBackground
      if (g) used.add(g.file)
      for (const v of Object.values(this.songs())) if (v.media) used.add(v.media.file)
      for (const f of readdirSync(this.dir)) if (!used.has(f)) rmSync(join(this.dir, f), { force: true })
    } catch (e) {
      log.warn('cleanup failed', (e as Error).message)
    }
  }
}

export const background = new BackgroundService()
