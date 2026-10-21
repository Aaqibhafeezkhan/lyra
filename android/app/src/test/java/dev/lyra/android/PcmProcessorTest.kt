package dev.lyra.android

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmProcessorTest {
    private fun tone(seconds: Int, amplitude: Float, hz: Double = 440.0): ShortArray {
        val n = PcmProcessor.RATE * seconds
        val out = ShortArray(n * 2)
        for (i in 0 until n) {
            val v = (sin(2 * PI * hz * i / PcmProcessor.RATE) * amplitude * 32767).toInt().toShort()
            out[i * 2] = v
            out[i * 2 + 1] = v
        }
        return out
    }

    private fun peak(a: ShortArray) = a.maxOf { abs(it.toInt()) } / 32768f

    @Test
    fun quietTakeIsBroughtUpButNeverClips() {
        val out = PcmProcessor.process(tone(6, 0.03f), fromMicrophone = false)
        assertTrue("louder than before", peak(out) > 0.06f)
        assertTrue("under the ceiling", peak(out) <= 0.8f)
    }

    @Test
    fun hotTakeStaysUnderTheCeiling() {
        val out = PcmProcessor.process(tone(6, 1.0f), fromMicrophone = false)
        assertTrue(peak(out) <= 0.8f)
    }

    @Test
    fun silenceStaysSilent() {
        val out = PcmProcessor.process(ShortArray(PcmProcessor.RATE * 2 * 4), fromMicrophone = true)
        assertEquals(0f, peak(out), 0.0001f)
    }

    @Test
    fun endsFadeToZero() {
        val out = PcmProcessor.process(tone(6, 0.3f), fromMicrophone = false)
        assertEquals(0, out[out.size - 1].toInt())
        assertTrue(abs(out[0].toInt()) < 400)
    }
}
