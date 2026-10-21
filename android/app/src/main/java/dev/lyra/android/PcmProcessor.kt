package dev.lyra.android

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.tanh

/**
 * Makes a recorded take sound like something you would post: quiet takes are brought up to about -14 LUFS, nothing
 * clips, the ends fade, and a microphone take gets a rumble filter and a gentle noise gate first (the room is much
 * quieter than the music, but once the music is turned up the room's hiss would come with it).
 *
 * Pure Kotlin on interleaved 16-bit stereo, so it can be unit-tested on the JVM.
 */
object PcmProcessor {
    const val RATE = 48000

    fun process(pcm: ShortArray, fromMicrophone: Boolean): ShortArray {
        val n = pcm.size / 2
        if (n == 0) return pcm
        val l = FloatArray(n) { pcm[it * 2] / 32768f }
        val r = FloatArray(n) { pcm[it * 2 + 1] / 32768f }
        if (fromMicrophone) {
            highPass(l)
            highPass(r)
            gate(l, r)
        }
        val gain = gainFor(l, r, fromMicrophone)
        val fadeIn = (RATE * 0.08).toInt()
        val fadeOut = (RATE * 0.3).toInt()
        val out = ShortArray(n * 2)
        for (i in 0 until n) {
            val f = min(1f, min((i + 1f) / fadeIn, (n - i).toFloat() / fadeOut)).coerceAtLeast(0f)
            out[i * 2] = toShort(softCeiling(l[i] * gain) * f)
            out[i * 2 + 1] = toShort(softCeiling(r[i] * gain) * f)
        }
        return out
    }

    /** Leaves normal levels alone; bends what goes above 0.6 towards a ceiling of 0.78 (-2.2 dBFS): the AAC encoder overshoots by about 0.7 dB. */
    fun softCeiling(x: Float): Float {
        val a = abs(x)
        if (a <= 0.6f) return x
        val y = 0.6f + 0.18f * tanh((a - 0.6f) / 0.18f)
        return if (x < 0) -y else y
    }

    private fun toShort(x: Float): Short = (x * 32767f).coerceIn(-32768f, 32767f).toInt().toShort()

    /** One-pole high-pass at about 60 Hz: removes handling noise and the low rumble of a table. */
    private fun highPass(a: FloatArray) {
        val k = 0.9922f
        var px = 0f
        var py = 0f
        for (i in a.indices) {
            val x = a[i]
            val y = k * (py + x - px)
            px = x
            py = y
            a[i] = y
        }
    }

    /**
     * Gentle downward expander: blocks that are about as quiet as the room (the quietest tenth of the take) are turned
     * down by up to 12 dB, smoothly, so the hiss does not get louder when the music is brought up.
     */
    private fun gate(l: FloatArray, r: FloatArray) {
        val block = 960 // 20 ms
        val blocks = l.size / block
        if (blocks < 20) return
        val rms = FloatArray(blocks)
        for (b in 0 until blocks) {
            var s = 0f
            for (i in b * block until (b + 1) * block step 2) s += l[i] * l[i] + r[i] * r[i]
            rms[b] = kotlin.math.sqrt(s / block)
        }
        val sorted = rms.filter { it > 1e-6f }.sorted()
        if (sorted.size < 10) return
        val floor = sorted[sorted.size / 10]
        val threshold = floor * 2.2f
        var g = 1f
        for (b in 0 until blocks) {
            val target = if (rms[b] >= threshold) 1f else max(0.25f, (rms[b] / threshold))
            // open quickly (20 ms), close slowly (80 ms)
            g += (target - g) * if (target > g) 0.6f else 0.2f
            for (i in b * block until (b + 1) * block) {
                l[i] *= g
                r[i] *= g
            }
        }
    }

    /**
     * Gain that brings the take to -14 LUFS, measured the way broadcasters do (ITU-R BS.1770: K-weighting, 400 ms
     * blocks, an absolute gate and a gate 10 dB below the average). Kept between 0.25x and 16x (a microphone take
     * can need a lot of help) and never more than 4x for a take that is not from the microphone.
     */
    fun gainFor(l: FloatArray, r: FloatArray, fromMicrophone: Boolean): Float {
        val kl = kWeight(l)
        val kr = kWeight(r)
        val block = 19200 // 400 ms
        val hop = 4800 // 75% overlap
        val ms = ArrayList<Double>()
        var s = 0
        while (s + block <= l.size) {
            var sum = 0.0
            for (i in s until s + block) sum += (kl[i] * kl[i] + kr[i] * kr[i]).toDouble()
            ms.add(sum / block)
            s += hop
        }
        fun lufs(m: Double) = -0.691 + 10.0 * log10(m + 1e-12)
        val loud = ms.filter { lufs(it) > -70.0 }
        if (loud.isEmpty()) return 1f
        val gate = lufs(loud.average()) - 10.0
        val kept = loud.filter { lufs(it) > gate }.ifEmpty { loud }
        val level = lufs(kept.average())
        val g = 10.0.pow((-14.0 - level) / 20.0).toFloat()
        val top = if (fromMicrophone) 16f else 4f
        return if (g.isFinite()) g.coerceIn(0.25f, top) else 1f
    }

    /** K-weighting: a high-shelf (head response) then a 38 Hz high-pass, at 48 kHz. */
    private fun kWeight(x: FloatArray): FloatArray {
        val a = biquad(x, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585)
        return biquad(a, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621)
    }

    private fun biquad(x: FloatArray, b0: Double, b1: Double, b2: Double, a1: Double, a2: Double): FloatArray {
        val y = FloatArray(x.size)
        var x1 = 0.0
        var x2 = 0.0
        var y1 = 0.0
        var y2 = 0.0
        for (i in x.indices) {
            val v = x[i].toDouble()
            val o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = v
            y2 = y1
            y1 = o
            y[i] = o.toFloat()
        }
        return y
    }
}
