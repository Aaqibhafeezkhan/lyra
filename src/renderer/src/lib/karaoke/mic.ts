import { centsFromNearestNote, detectPitch, rms } from './pitch'
import type { Frame } from './score'

/**
 * The singer's microphone, read about 20 times a second: is the voice there, and which note is it on. No echo
 * cancelling, noise gate or auto gain (they would eat the singing). A short calibration listens to the room first; the
 * voice must be clearly louder than that.
 */
export interface Mic {
  /** level of the voice, 0..1, for the meter */
  level(): number
  /** the room as measured (rms) */
  ambient(): number
  /** start calling back with a reading; returns stop */
  watch(cb: (f: { rms: number; voiced: boolean; cents: number | null; hz: number | null }) => void): () => void
  /** listen for a moment and set the threshold from the room */
  calibrate(ms: number): Promise<number>
  stop(): void
}

export async function openMic(): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  src.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  let gate = 0.02
  let room = 0
  let lastLevel = 0

  const read = (): { rms: number; voiced: boolean; cents: number | null; hz: number | null } => {
    analyser.getFloatTimeDomainData(buf)
    const r = rms(buf)
    lastLevel = r
    const voiced = r > gate
    let cents: number | null = null
    let hz: number | null = null
    if (voiced) {
      const p = detectPitch(buf, ctx.sampleRate)
      if (p && p.clarity >= 0.8) {
        hz = p.hz
        cents = centsFromNearestNote(p.hz)
      }
    }
    return { rms: r, voiced, cents, hz }
  }

  return {
    level: () => Math.min(1, lastLevel * 6),
    ambient: () => room,
    watch(cb) {
      const id = window.setInterval(() => cb(read()), 50)
      return () => window.clearInterval(id)
    },
    async calibrate(ms) {
      const samples: number[] = []
      const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        analyser.getFloatTimeDomainData(buf)
        samples.push(rms(buf))
        await new Promise((r) => setTimeout(r, 50))
      }
      samples.sort((a, b) => a - b)
      room = samples[Math.floor(samples.length * 0.9)] ?? 0
      gate = Math.max(0.012, room * 2.2)
      return gate
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    }
  }
}

export type { Frame }
