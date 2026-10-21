package dev.lyra.android

import android.annotation.SuppressLint
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import java.io.FileDescriptor
import java.nio.ByteBuffer

/**
 * Records what Lyra shows on screen plus the sound of one app (Spotify, through Android's "audio playback capture")
 * into an MP4. The screen comes from a MediaProjection virtual display drawn straight into an H.264 encoder; the sound
 * goes through an AAC encoder. Both are cut to one clock and written by one muxer.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class ScreenRecorder(
    private val projection: MediaProjection,
    private val out: FileDescriptor,
    private val width: Int,
    private val height: Int,
    private val dpi: Int,
    /** only this app's sound is captured; null = every app's media sound */
    private val soundUid: Int?,
    /** when the playback capture stays silent while music plays, listen with the microphone instead */
    private val micFallback: Boolean = true
) {
    private val muxer = MediaMuxer(out, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private val venc = MediaCodec.createEncoderByType("video/avc")
    private val aenc = MediaCodec.createEncoderByType("audio/mp4a-latm")
    private var display: VirtualDisplay? = null
    @Volatile private var audio: AudioRecord? = null
    /** true once the sound comes from the microphone because the phone would not hand over the music app's sound */
    @Volatile var usingMic = false
        private set
    private var vThread: Thread? = null
    private var aThread: Thread? = null

    @Volatile private var stopping = false
    @Volatile var failure: String? = null
        private set

    // the muxer starts when both tracks know their format; samples that come earlier wait here
    private val lock = Any()
    private var vTrack = -1
    private var aTrack = -1
    private var started = false
    private var finished = false
    private class Pending(val track: Int, val data: ByteBuffer, val info: MediaCodec.BufferInfo)
    private val pending = ArrayList<Pending>()
    private var originUs = -1L

    /**
     * Start recording. If anything fails half way, everything created so far is released again: a leaked sound
     * capture would make Android refuse the next recording ("could not register audio policy").
     */
    fun start() {
        current?.abort() // a recorder an earlier failed attempt left behind
        current = this
        try {
            startInner()
        } catch (e: Exception) {
            abort()
            throw e
        }
    }

    /** Release every piece without writing a file (the caller deletes the half-made video). */
    fun abort() {
        stopping = true
        try { audio?.stop() } catch (_: Exception) { }
        try { audio?.release() } catch (_: Exception) { }
        audio = null
        try { display?.release() } catch (_: Exception) { }
        for (c in listOf(venc, aenc)) {
            try { c.stop() } catch (_: Exception) { }
            try { c.release() } catch (_: Exception) { }
        }
        try { muxer.release() } catch (_: Exception) { }
        if (current === this) current = null
    }

    @SuppressLint("MissingPermission") // RECORD_AUDIO is requested by RecordActivity before this starts
    private fun startInner() {
        val vf = MediaFormat.createVideoFormat("video/avc", width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 9_000_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            // a still screen (a paused line, the end card) still produces frames, so the picture never stalls
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000L)
        }
        venc.configure(vf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = venc.createInputSurface()
        venc.start()

        val cfg = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .apply { if (soundUid != null) addMatchingUid(soundUid) }
            .build()
        val fmt = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build()
        val rec = AudioRecord.Builder().setAudioPlaybackCaptureConfig(cfg).setAudioFormat(fmt).setBufferSizeInBytes(RATE * 4).build()
        check(rec.state == AudioRecord.STATE_INITIALIZED) { "Android would not let Lyra capture the sound" }
        audio = rec
        val af = MediaFormat.createAudioFormat("audio/mp4a-latm", RATE, 2).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 160_000)
        }
        aenc.configure(af, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        aenc.start()

        // the display must not be created before its callback exists (Android 14)
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (!stopping) failure = "Screen recording was stopped by Android."; android.util.Log.e("LyraRec", "projection stopped")
            }
        }, Handler(Looper.getMainLooper()))
        display = projection.createVirtualDisplay("lyra-record", width, height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null)

        rec.startRecording()
        vThread = Thread({ drainVideo() }, "lyra-rec-video").also { it.isDaemon = true; it.start() }
        aThread = Thread({ pumpAudio(rec) }, "lyra-rec-audio").also { it.isDaemon = true; it.start() }
    }

    private fun fail(e: Exception) {
        android.util.Log.e("LyraRec", "recording failed", e)
        failure = failure ?: (e.message ?: e.javaClass.simpleName)
    }

    /** Stop, flush both encoders and close the file. Safe to call once; returns when the MP4 is complete. */
    fun stop() {
        if (stopping) return
        stopping = true
        try {
            audio?.stop()
        } catch (_: Exception) {
        }
        try {
            venc.signalEndOfInputStream()
        } catch (_: Exception) {
        }
        vThread?.join(5000)
        aThread?.join(5000)
        display?.release()
        audio?.release()
        synchronized(lock) {
            if (started && !finished) {
                finished = true
                try {
                    muxer.stop()
                } catch (e: Exception) {
                    fail(e)
                }
            }
            try {
                muxer.release()
            } catch (_: Exception) {
            }
        }
        for (c in listOf(venc, aenc)) {
            try {
                c.stop()
            } catch (_: Exception) {
            }
            c.release()
        }
        projection.stop()
        if (current === this) current = null
    }

    private fun write(track: Int, data: ByteBuffer, info: MediaCodec.BufferInfo) {
        synchronized(lock) {
            if (finished) return
            if (originUs < 0) originUs = info.presentationTimeUs
            val b = MediaCodec.BufferInfo().apply { set(info.offset, info.size, (info.presentationTimeUs - originUs).coerceAtLeast(0), info.flags) }
            if (!started) {
                // copy: the codec reuses its buffer after release
                val copy = ByteBuffer.allocate(info.size).also { it.put(data.apply { position(info.offset); limit(info.offset + info.size) }); it.flip() }
                b.set(0, info.size, b.presentationTimeUs, b.flags)
                pending.add(Pending(track, copy, b))
                return
            }
            muxer.writeSampleData(track, data, b)
        }
    }

    private fun maybeStartMuxer() {
        synchronized(lock) {
            if (started || vTrack < 0 || aTrack < 0) return
            muxer.start()
            started = true
            for (p in pending) muxer.writeSampleData(p.track, p.data, p.info)
            pending.clear()
        }
    }

    private fun drainVideo() {
        val info = MediaCodec.BufferInfo()
        try {
            while (true) {
                val i = venc.dequeueOutputBuffer(info, 10_000)
                when {
                    i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        synchronized(lock) { vTrack = muxer.addTrack(venc.outputFormat) }
                        maybeStartMuxer()
                    }
                    i >= 0 -> {
                        val buf = venc.getOutputBuffer(i)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) write(vTrack, buf, info)
                        venc.releaseOutputBuffer(i, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                    else -> Unit // nothing yet; keep waiting for the end-of-stream buffer
                }
            }
        } catch (e: Exception) {
            fail(e)
        }
    }

    private fun pumpAudio(first: AudioRecord) {
        var rec = first
        val pcm = ByteArray(RATE / 25 * 4) // 40 ms
        val info = MediaCodec.BufferInfo()
        var frames = 0L
        var t0 = -1L
        var eosSent = false
        // some phones (a Samsung Galaxy A54 with Spotify, for one) accept the capture but never route the app's sound into it
        var peak = 0
        var judged = !micFallback
        try {
            while (true) {
                if (!stopping) {
                    val n = rec.read(pcm, 0, pcm.size)
                    if (n > 0) {
                        // the clock the screen frames use (CLOCK_MONOTONIC); the first block started that long ago
                        if (t0 < 0) t0 = System.nanoTime() / 1000 - n / 4 * 1_000_000L / RATE
                        feed(pcm, n, t0 + frames * 1_000_000L / RATE, false)
                        frames += n / 4
                        if (!judged) {
                            for (k in 0 until n - 1 step 2) peak = maxOf(peak, kotlin.math.abs(((pcm[k + 1].toInt() shl 8) or (pcm[k].toInt() and 0xff)).toShort().toInt()))
                            if (frames >= RATE * 5L) {
                                judged = true
                                // five seconds of music playing and not one sample of sound: use the microphone from here on
                                if (peak < 12 && MediaMonitor.now()?.playing == true) {
                                    val mic = openMic()
                                    if (mic != null) {
                                        android.util.Log.w("LyraRec", "playback capture is silent; switching to the microphone")
                                        try { rec.stop() } catch (_: Exception) { }
                                        rec.release()
                                        rec = mic
                                        audio = mic
                                        usingMic = true
                                    }
                                }
                            }
                        }
                    }
                } else if (!eosSent) {
                    feed(pcm, 0, (if (t0 < 0) 0 else t0) + frames * 1_000_000L / RATE, true)
                    eosSent = true
                }
                if (drainAudio(info)) return
            }
        } catch (e: Exception) {
            fail(e)
        }
    }

    /** The microphone, as unprocessed as the phone allows (no echo cancelling or noise gate that would eat music). */
    @SuppressLint("MissingPermission")
    private fun openMic(): AudioRecord? {
        val fmt = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build()
        for (source in intArrayOf(android.media.MediaRecorder.AudioSource.UNPROCESSED, android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION, android.media.MediaRecorder.AudioSource.MIC)) {
            try {
                val r = AudioRecord.Builder().setAudioSource(source).setAudioFormat(fmt).setBufferSizeInBytes(RATE * 4).build()
                if (r.state == AudioRecord.STATE_INITIALIZED) {
                    r.startRecording()
                    return r
                }
                r.release()
            } catch (_: Exception) {
            }
        }
        return null
    }

    /** Hand PCM to the AAC encoder in pieces that fit its input buffers (draining its output while it is busy). */
    private fun feed(pcm: ByteArray, n: Int, ptsUs: Long, eos: Boolean) {
        if (eos) {
            var i = aenc.dequeueInputBuffer(100_000)
            while (i < 0) {
                drainAudio(MediaCodec.BufferInfo())
                i = aenc.dequeueInputBuffer(100_000)
            }
            aenc.queueInputBuffer(i, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            return
        }
        var off = 0
        val info = MediaCodec.BufferInfo()
        while (off < n) {
            val i = aenc.dequeueInputBuffer(20_000)
            if (i < 0) {
                drainAudio(info)
                continue
            }
            val buf = aenc.getInputBuffer(i)!!
            buf.clear()
            val len = minOf(n - off, buf.capacity() / 4 * 4)
            buf.put(pcm, off, len)
            aenc.queueInputBuffer(i, 0, len, ptsUs + off / 4 * 1_000_000L / RATE, 0)
            off += len
        }
    }

    /** true once the encoder has delivered its last buffer */
    private fun drainAudio(info: MediaCodec.BufferInfo): Boolean {
        while (true) {
            val i = aenc.dequeueOutputBuffer(info, 0)
            when {
                i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    synchronized(lock) { aTrack = muxer.addTrack(aenc.outputFormat) }
                    maybeStartMuxer()
                }
                i >= 0 -> {
                    val buf = aenc.getOutputBuffer(i)!!
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) write(aTrack, buf, info)
                    aenc.releaseOutputBuffer(i, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return true
                }
                else -> return false
            }
        }
    }

    companion object {
        @Volatile private var current: ScreenRecorder? = null
        const val RATE = 48000
    }
}
