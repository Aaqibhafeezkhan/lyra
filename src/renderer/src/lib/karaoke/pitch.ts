/**
 * Pitch of a sung note, from a short slice of the microphone (YIN, de Cheveigne and Kawahara 2002).
 * Pure, so it can be tested with generated tones.
 */
export interface Pitch {
  hz: number
  /** 0..1: how clearly periodic the sound is (a sung vowel is high, hiss and consonants are low) */
  clarity: number
}

/** Lowest and highest note we look for: a low male voice (80 Hz) up to a high female voice (1000 Hz). */
const MIN_HZ = 80
const MAX_HZ = 1000

export function detectPitch(buf: Float32Array, sampleRate: number): Pitch | null {
  const half = Math.floor(buf.length / 2)
  const maxTau = Math.min(half, Math.floor(sampleRate / MIN_HZ))
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ))
  if (maxTau <= minTau + 2) return null

  // difference function
  const d = new Float32Array(maxTau)
  for (let tau = 1; tau < maxTau; tau++) {
    let sum = 0
    for (let i = 0; i < half; i++) {
      const diff = buf[i]! - buf[i + tau]!
      sum += diff * diff
    }
    d[tau] = sum
  }
  // cumulative mean normalised difference
  const cmnd = new Float32Array(maxTau)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau < maxTau; tau++) {
    running += d[tau]!
    cmnd[tau] = running === 0 ? 1 : (d[tau]! * tau) / running
  }
  // first dip under the threshold, then walk down to its bottom
  const threshold = 0.15
  let tau = -1
  for (let t = minTau; t < maxTau - 1; t++) {
    if (cmnd[t]! < threshold) {
      while (t + 1 < maxTau - 1 && cmnd[t + 1]! < cmnd[t]!) t++
      tau = t
      break
    }
  }
  if (tau < 0) return null
  // parabolic interpolation around the minimum for a finer estimate
  const a = cmnd[tau - 1]!
  const b = cmnd[tau]!
  const c = cmnd[tau + 1]!
  const denom = a - 2 * b + c
  const shift = denom === 0 ? 0 : (a - c) / (2 * denom)
  const refined = tau + Math.max(-1, Math.min(1, shift))
  return { hz: sampleRate / refined, clarity: Math.max(0, Math.min(1, 1 - b)) }
}

/** How far a frequency is from the nearest note of the equal-tempered scale, in cents (-50..+50). */
export function centsFromNearestNote(hz: number): number {
  const midi = 69 + 12 * Math.log2(hz / 440)
  return (midi - Math.round(midi)) * 100
}

/** Root mean square of a slice: the loudness of the voice. */
export function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!
  return Math.sqrt(sum / Math.max(1, buf.length))
}
