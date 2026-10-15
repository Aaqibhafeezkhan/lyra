import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { CommandResult, PlaybackSnapshot, PlayerCommand, QueueItem, RecentItem, Track } from '@shared/types'
import { createLogger } from '../logger'
import { PlaybackSource } from '../source'
import { SMTC_SCRIPT } from './script'

const log = createLogger('smtc')

interface Msg {
  ready?: boolean
  error?: string
  found?: boolean
  app?: string
  title?: string
  artist?: string
  album?: string
  durationMs?: number
  positionMs?: number
  playing?: boolean
  thumb?: string
}

const UNSUPPORTED = (what: string): CommandResult => ({
  ok: false,
  reason: 'unsupported',
  error: `${what} isn’t exposed by Windows media controls. Use the Spotify app or your system volume.`
})

/**
 * Reads the Spotify desktop app through Windows media controls (SMTC). No account, API key or
 * Premium needed. Limits: no volume, queue, likes or release year.
 */
export class SmtcSource extends PlaybackSource {
  readonly kind = 'smtc' as const
  private proc: ChildProcessWithoutNullStreams | null = null
  private stopped = true
  private restartTimer: NodeJS.Timeout | null = null
  private lastEmitted: PlaybackSnapshot | null = null
  private thumbs = new Map<string, string>()
  private failures = 0

  start(): void {
    if (process.platform !== 'win32') {
      this.setStatus({ state: 'offline', message: 'Windows media controls are only available on Windows.' })
      return
    }
    this.stopped = false
    this.setStatus({ state: 'local', message: 'Spotify desktop app · Windows media controls' })
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.proc?.kill()
    this.proc = null
  }

  private spawn(): void {
    const dir = join(app.getPath('userData'), 'bridge')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'smtc.ps1')
    writeFileSync(file, '﻿' + SMTC_SCRIPT, 'utf8')

    const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true
    })
    this.proc = proc
    createInterface({ input: proc.stdout }).on('line', (l) => this.onLine(l))
    proc.stderr.on('data', (d: Buffer) => log.warn('powershell:', d.toString().trim().slice(0, 300)))
    proc.on('error', (e) => this.onExit(`could not start PowerShell: ${e.message}`))
    proc.on('exit', (code) => this.onExit(`bridge exited (${code})`))
  }

  private onExit(why: string): void {
    this.proc = null
    if (this.stopped) return
    this.failures++
    log.warn(why)
    this.setStatus({ state: 'offline', message: 'Lost the connection to Windows media controls. Retrying…', retryInSec: 3 })
    this.restartTimer = setTimeout(() => !this.stopped && this.spawn(), Math.min(15_000, 3000 * this.failures))
  }

  private onLine(raw: string): void {
    let m: Msg
    try {
      m = JSON.parse(raw.replace(/^﻿/, '')) as Msg
    } catch {
      return
    }
    if (m.ready) {
      this.failures = 0
      this.setStatus({ state: 'local', message: 'Spotify desktop app · Windows media controls' })
      return
    }
    if (m.error) {
      log.warn('bridge error', m.error)
      return
    }
    if (this.status.state !== 'local') this.setStatus({ state: 'local', message: 'Spotify desktop app · Windows media controls' })

    const now = Date.now()
    let snap: PlaybackSnapshot
    const base = {
      sampledAt: now,
      device: { id: null, name: 'Spotify (Windows)', type: 'Computer', volumePercent: null, supportsVolume: false },
      shuffle: false,
      repeat: 'off' as const
    }
    if (!m.found) {
      snap = { ...base, track: null, isPlaying: false, positionMs: 0, device: null, isAdOrUnknown: false }
    } else if (!m.title || m.title === 'Advertisement' || m.title === 'Spotify') {
      snap = { ...base, track: null, isPlaying: !!m.playing, positionMs: 0, isAdOrUnknown: true }
    } else {
      const dur = m.durationMs ?? 0
      const id = 'smtc:' + createHash('sha1').update(`${m.title}|${m.artist}|${m.album}|${Math.round(dur / 1000)}`).digest('hex').slice(0, 16)
      if (m.thumb) {
        this.thumbs.set(id, m.thumb)
        if (this.thumbs.size > 20) this.thumbs.delete(this.thumbs.keys().next().value as string)
      }
      const track: Track = {
        id,
        uri: id,
        title: m.title,
        artists: m.artist ? [m.artist] : [],
        album: m.album ?? '',
        releaseYear: null,
        durationMs: dur,
        artworkUrl: this.thumbs.get(id) ?? null,
        explicit: false,
        webUrl: null
      }
      snap = { ...base, track, isPlaying: !!m.playing, positionMs: m.positionMs ?? 0, isAdOrUnknown: false }
    }
    this.snapshot = snap
    if (this.shouldEmit(snap)) {
      this.lastEmitted = snap
      this.emit('snapshot', snap)
    }
  }

  private shouldEmit(n: PlaybackSnapshot): boolean {
    const o = this.lastEmitted
    if (!o) return true
    if (o.track?.id !== n.track?.id || o.isPlaying !== n.isPlaying || o.isAdOrUnknown !== n.isAdOrUnknown) return true
    if (o.track?.artworkUrl !== n.track?.artworkUrl) return true // artwork arrives a tick after the track
    const predicted = o.positionMs + (o.isPlaying ? n.sampledAt - o.sampledAt : 0)
    return Math.abs(predicted - n.positionMs) > 1500
  }

  async command(cmd: PlayerCommand): Promise<CommandResult> {
    if (!this.proc) return { ok: false, reason: 'offline', error: 'Windows media bridge isn’t running.' }
    if (!this.snapshot?.track && cmd.type !== 'toggle' && cmd.type !== 'play') {
      return { ok: false, reason: 'no-device', error: 'Spotify isn’t playing anything.' }
    }
    switch (cmd.type) {
      case 'play':
      case 'pause':
      case 'toggle':
        this.proc.stdin.write(`${cmd.type}\n`)
        return { ok: true }
      case 'next':
        this.proc.stdin.write('next\n')
        return { ok: true }
      case 'previous':
        this.proc.stdin.write('prev\n')
        return { ok: true }
      case 'seek':
        this.proc.stdin.write(`seek:${Math.max(0, Math.round(cmd.positionMs))}\n`)
        return { ok: true }
      case 'volume':
        return UNSUPPORTED('Volume')
      case 'shuffle':
        return UNSUPPORTED('Shuffle')
      case 'repeat':
        return UNSUPPORTED('Repeat')
    }
  }

  async isLiked(): Promise<boolean | null> {
    return null
  }
  async setLiked(): Promise<CommandResult> {
    return UNSUPPORTED('Liking songs')
  }
  async queue(): Promise<QueueItem[] | null> {
    return null
  }
  async recent(): Promise<RecentItem[] | null> {
    return null
  }
}
