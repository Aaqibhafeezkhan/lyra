// Measures how smooth an exported lyric video is.   node scripts/analyze-video.js <file.mp4>
// Needs ffprobe and ffmpeg on the PATH (or FFPROBE / FFMPEG pointing at them).
// Prints frame-rate statistics, the longest freeze, and the audio loudness, then checks them against the targets
// from docs/windows-export-quality.md. Exit code 1 when a target is missed.
const { execFileSync, spawnSync } = require('node:child_process')

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/analyze-video.js <file.mp4>')
  process.exit(2)
}
const FFPROBE = process.env.FFPROBE || 'ffprobe'
const FFMPEG = process.env.FFMPEG || 'ffmpeg'

const run = (bin, args, opts = {}) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })

const times = run(FFPROBE, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file])
  .split(/\s+/)
  .map(Number)
  .filter((n) => Number.isFinite(n))
  .sort((a, b) => a - b)
if (times.length < 3) {
  console.error('no video frames found')
  process.exit(2)
}
const gaps = times.slice(1).map((t, i) => (t - times[i]) * 1000)
const sorted = [...gaps].sort((a, b) => a - b)
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
const span = times[times.length - 1] - times[0]
const fps = (times.length - 1) / span
const frameMs = 1000 / Math.round(fps)

const stream = run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_name,profile,level,width,height,r_frame_rate,sample_rate,channels,bit_rate', '-of', 'compact', file]).trim()

const probe = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-vn', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const all = String(probe.stderr || '')
const audio = all.includes('Summary:') ? all.slice(all.lastIndexOf('Summary:')) : all
const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(audio || '')
const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(audio || '')

const result = {
  frames: times.length,
  seconds: +span.toFixed(1),
  fps: +fps.toFixed(2),
  gapMedianMs: +q(0.5).toFixed(1),
  gapP99Ms: +q(0.99).toFixed(1),
  gapMaxMs: +Math.max(...gaps).toFixed(1),
  gapsOver2x: gaps.filter((g) => g > frameMs * 2.5).length,
  loudnessLufs: lufs ? +lufs[1] : null,
  truePeakDb: peak ? +peak[1] : null
}
console.log(stream)
console.log(result)

const fails = []
// a phone mirrors its screen and may skip a frame or two (a 50 ms hiccup is not seen as a freeze): --phone allows that
const phone = process.argv.includes('--phone')
const p99Limit = phone ? 3 : 1.5
if (phone ? result.gapP99Ms > 1000 / 60 * p99Limit : result.gapP99Ms > frameMs * p99Limit) fails.push(`p99 frame gap ${result.gapP99Ms} ms is over the limit`)
if (result.gapMaxMs > (phone ? 70 : frameMs * 3)) fails.push(`longest freeze ${result.gapMaxMs} ms is too long`)
if (result.loudnessLufs !== null && result.loudnessLufs < -60) console.log('note: the sound is silent (a test run with nothing playing?)')
else if (result.loudnessLufs !== null && Math.abs(result.loudnessLufs + 14) > 3) fails.push(`loudness ${result.loudnessLufs} LUFS is far from -14`)
if (result.truePeakDb !== null && result.truePeakDb > -0.5) fails.push(`peak ${result.truePeakDb} dBFS is too hot`)
if (fails.length) {
  console.log('\nFAIL')
  for (const f of fails) console.log(' - ' + f)
  process.exit(1)
}
console.log('\nPASS: smooth, no freezes')
