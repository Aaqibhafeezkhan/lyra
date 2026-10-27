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
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileDescriptor
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Records what Lyra shows on screen together with the song's sound into one MP4, in two steps:
 *
 *  1. WHILE RECORDING: the screen goes into an H.264 encoder (a video-only temp file), and the sound is saved as raw
 *     PCM. Two sound sources run side by side: Android's playback capture of the music app, and the microphone (a
 *     phone may refuse to hand the app's sound over, a Samsung Galaxy A54 does for Spotify).
 *  2. AT THE END: the better of the two takes is cleaned and brought to about -14 LUFS ([PcmProcessor]), encoded to AAC,
 *     and muxed with the video. Because both sources ran from the first second, nothing at the start is lost.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class ScreenRecorder(
    private val projection: MediaProjection,
    private val out: FileDescriptor,
    cacheDir: File,
    private val width: Int,
    private val height: Int,
    private val dpi: Int,
    /** only this app's sound is captured; null = every app's media sound */
    private val soundUid: Int?,
    /** also listen with the microphone, as the second choice */
    private val micEnabled: Boolean = true
) {
    private val dir = File(cacheDir, "rec-" + System.nanoTime()).apply { mkdirs() }
    private val videoFile = File(dir, "video.mp4")
    private val vmux = MediaMuxer(videoFile.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private val venc = MediaCodec.createEncoderByType("video/avc")
    private var display: VirtualDisplay? = null
    private var vThread: Thread? = null
    private var capture: Tap? = null
    private var mic: Tap? = null

    @Volatile private var stopping = false
    private var stopped = false
    @Volatile var failure: String? = null
        private set

    /** which sound ended up in the video: "capture", "microphone" or "none" (set by [stop]) */
    @Volatile var soundSource: String = "none"
        private set

    /** Peak input level of the audio source selected for the finished video, in dBFS. */
    @Volatile var soundLevelDbfs: Double? = null
        private set

    private var vTrack = -1
    private var originUs = -1L // presentation time of the first video sample
    private val lock = Any()

    /** One sound source: reads PCM and appends it to a file, remembering how loud it was. */
    private inner class Tap(val rec: AudioRecord, val file: File) {
        @Volatile var peak = 0
        @Volatile var loud = 0L // samples clearly above silence
        @Volatile var frames = 0L
        @Volatile var t0Us = -1L
        private var thread: Thread? = null

        fun start() {
            rec.startRecording()
            thread = Thread({ run() }, "lyra-rec-pcm").also { it.isDaemon = true; it.start() }
        }

        private fun run() {
            val buf = ByteArray(RATE / 25 * 4) // 40 ms
            try {
                BufferedOutputStream(FileOutputStream(file), 1 shl 16).use { o ->
                    while (!stopping) {
                        val n = rec.read(buf, 0, buf.size)
                        if (n <= 0) {
                            if (n < 0) break
                            continue
                        }
                        // the clock the screen frames use (CLOCK_MONOTONIC); the first block started that long ago
                        if (t0Us < 0) t0Us = System.nanoTime() / 1000 - n / 4 * 1_000_000L / RATE
                        o.write(buf, 0, n)
                        frames += n / 4
                        var p = peak
                        var k = 0
                        while (k < n - 1) {
                            val v = abs(((buf[k + 1].toInt() shl 8) or (buf[k].toInt() and 0xff)).toShort().toInt())
                            if (v > p) p = v
                            if (v > 300) loud++
                            k += 2
                        }
                        peak = p
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("LyraRec", "sound tap stopped: " + e.message)
            }
        }

        fun finish() {
            try { rec.stop() } catch (_: Exception) { }
            thread?.join(3000)
            try { rec.release() } catch (_: Exception) { }
        }

        /** this take has real sound: not silent, and more than a few clicks */
        fun usable(): Boolean = peak >= 100 && frames > 0 && loud * 12 >= frames // at least about 8% of the samples are clearly audible
    }

    private fun abs(v: Int) = if (v < 0) -v else v

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
        capture?.let { try { it.rec.stop() } catch (_: Exception) { }; try { it.rec.release() } catch (_: Exception) { } }
        mic?.let { try { it.rec.stop() } catch (_: Exception) { }; try { it.rec.release() } catch (_: Exception) { } }
        capture = null
        mic = null
        try { display?.release() } catch (_: Exception) { }
        try { venc.stop() } catch (_: Exception) { }
        try { venc.release() } catch (_: Exception) { }
        try { vmux.release() } catch (_: Exception) { }
        dir.deleteRecursively()
        if (current === this) current = null
    }

    @SuppressLint("MissingPermission") // RECORD_AUDIO is requested by RecordActivity before this starts
    private fun startInner() {
        val vf = MediaFormat.createVideoFormat("video/avc", width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 12_000_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, 60)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh)
            setInteger(MediaFormat.KEY_PRIORITY, 0) // real time: the screen is being filmed as it happens
            setInteger("max-fps-to-encoder", 60)
            // a still screen (a paused line, the end card) still produces frames, so the picture never stalls
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 50_000L)
        }
        venc.configure(vf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = venc.createInputSurface()
        venc.start()

        val fmt = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build()
        // The music app's own sound is a bonus, not a requirement: some phones refuse to register the capture
        // ("could not register audio policy"), and most do not hand Spotify's sound over anyway. If it fails (after one
        // retry, in case an earlier recording was still letting go) the recording simply goes on with the microphone.
        capture = openCapture(fmt)

        // the microphone runs from the first second too, so a phone that refuses the capture loses nothing at the start
        if (micEnabled) {
            for (source in intArrayOf(MediaRecorder.AudioSource.UNPROCESSED, MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC)) {
                try {
                    val m = AudioRecord.Builder().setAudioSource(source).setAudioFormat(fmt).setBufferSizeInBytes(RATE * 4).build()
                    if (m.state == AudioRecord.STATE_INITIALIZED) {
                        mic = Tap(m, File(dir, "mic.pcm"))
                        break
                    }
                    m.release()
                } catch (_: Exception) {
                }
            }
        }

        // the display must not be created before its callback exists (Android 14)
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (!stopping) {
                    failure = "Screen recording was stopped by Android."
                    android.util.Log.e("LyraRec", "projection stopped")
                }
            }
        }, Handler(Looper.getMainLooper()))
        display = projection.createVirtualDisplay("lyra-record", width, height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null)

        check(capture != null || mic != null) { "Lyra could not start recording the sound. Check that the microphone permission is allowed for Lyra." }
        capture?.start()
        mic?.start()
        vThread = Thread({ drainVideo() }, "lyra-rec-video").also { it.isDaemon = true; it.start() }
    }

    /** The playback capture of the music app, or null when this phone will not give it to us. */
    @SuppressLint("MissingPermission")
    private fun openCapture(fmt: AudioFormat): Tap? {
        for (attempt in 1..2) {
            try {
                val cfg = AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .apply { if (soundUid != null) addMatchingUid(soundUid) }
                    .build()
                val rec = AudioRecord.Builder().setAudioPlaybackCaptureConfig(cfg).setAudioFormat(fmt).setBufferSizeInBytes(RATE * 4).build()
                if (rec.state == AudioRecord.STATE_INITIALIZED) return Tap(rec, File(dir, "capture.pcm"))
                rec.release()
            } catch (e: Exception) {
                android.util.Log.w("LyraRec", "playback capture refused (attempt $attempt): " + e.message)
            }
            if (attempt == 1) Thread.sleep(400)
        }
        return null
    }

    private fun fail(e: Exception) {
        android.util.Log.e("LyraRec", "recording failed", e)
        failure = failure ?: (e.message ?: e.javaClass.simpleName)
    }

    /** Video samples go to the temp file with the first sample as time zero. */
    private fun drainVideo() {
        val info = MediaCodec.BufferInfo()
        try {
            while (true) {
                val i = venc.dequeueOutputBuffer(info, 10_000)
                when {
                    i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        synchronized(lock) {
                            vTrack = vmux.addTrack(venc.outputFormat)
                            vmux.start()
                        }
                    }
                    i >= 0 -> {
                        val buf = venc.getOutputBuffer(i)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0 && vTrack >= 0) {
                            if (originUs < 0) originUs = info.presentationTimeUs
                            val b = MediaCodec.BufferInfo().apply { set(info.offset, info.size, (info.presentationTimeUs - originUs).coerceAtLeast(0), info.flags) }
                            synchronized(lock) { vmux.writeSampleData(vTrack, buf, b) }
                        }
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

    /**
     * Stop, then build the final MP4: choose the sound, clean it, encode it, and mux it with the recorded video.
     * Takes a few seconds for a long recording. Safe to call once.
     */
    fun stop() {
        if (stopped) return
        stopped = true
        stopping = true
        try { venc.signalEndOfInputStream() } catch (_: Exception) { }
        capture?.finish()
        mic?.finish()
        vThread?.join(5000)
        try { display?.release() } catch (_: Exception) { }
        try {
            synchronized(lock) { if (vTrack >= 0) vmux.stop() }
        } catch (e: Exception) {
            fail(e)
        }
        try { vmux.release() } catch (_: Exception) { }
        try { venc.stop() } catch (_: Exception) { }
        try { venc.release() } catch (_: Exception) { }
        projection.stop()
        try {
            assemble()
        } catch (e: Exception) {
            fail(e)
        } finally {
            dir.deleteRecursively()
            if (current === this) current = null
        }
    }

    /** The sound take that has real sound: the music app's own sound if it arrived, else the microphone. */
    private fun chosenTap(): Tap? = when {
        capture?.usable() == true -> capture
        mic?.usable() == true -> mic
        else -> null
    }

    private fun assemble() {
        val tap = chosenTap()
        soundSource = when {
            tap == null -> "none"
            tap === capture -> "capture"
            else -> "microphone"
        }
        android.util.Log.i("LyraRec", "sound: $soundSource (capture peak ${capture?.peak}, mic peak ${mic?.peak})")
        soundLevelDbfs = tap?.peak?.takeIf { it > 0 }?.let { 20.0 * kotlin.math.log10(it / 32768.0) }

        // ---- the sound: read, align to the first video frame, clean, encode
        var aacFormat: MediaFormat? = null
        val aacSamples = ArrayList<Pair<ByteArray, MediaCodec.BufferInfo>>()
        if (tap != null) {
            val raw = tap.file.readBytes()
            val shorts = ShortArray(raw.size / 2)
            ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)
            // the sound and the picture started at slightly different moments: line them up
            val deltaFrames = if (originUs >= 0 && tap.t0Us >= 0) ((tap.t0Us - originUs) * RATE / 1_000_000L).toInt() else 0
            val aligned = when {
                deltaFrames > 0 -> ShortArray(deltaFrames * 2) + shorts
                deltaFrames < 0 && -deltaFrames * 2 < shorts.size -> shorts.copyOfRange(-deltaFrames * 2, shorts.size)
                else -> shorts
            }
            val processed = PcmProcessor.process(aligned, tap === mic)
            val res = encodeAac(processed)
            aacFormat = res.first
            aacSamples.addAll(res.second)
        }

        // ---- mux: the recorded video samples + the new sound
        val extractor = MediaExtractor()
        extractor.setDataSource(videoFile.path)
        var vIndex = -1
        for (i in 0 until extractor.trackCount) {
            if (extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) vIndex = i
        }
        check(vIndex >= 0) { "No picture was recorded." }
        extractor.selectTrack(vIndex)
        val muxer = MediaMuxer(out, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val vOut = muxer.addTrack(extractor.getTrackFormat(vIndex))
        val aOut = if (aacFormat != null) muxer.addTrack(aacFormat) else -1
        muxer.start()
        val buf = ByteBuffer.allocate(2 shl 20)
        val bi = MediaCodec.BufferInfo()
        var lastVideoUs = 0L
        while (true) {
            buf.clear()
            val size = extractor.readSampleData(buf, 0)
            if (size < 0) break
            bi.set(0, size, extractor.sampleTime, if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            muxer.writeSampleData(vOut, buf, bi)
            lastVideoUs = extractor.sampleTime
            extractor.advance()
        }
        extractor.release()
        if (aOut >= 0) {
            for ((bytes, info) in aacSamples) {
                if (info.presentationTimeUs > lastVideoUs + 500_000) break // never let the sound run on past the picture
                muxer.writeSampleData(aOut, ByteBuffer.wrap(bytes), info)
            }
        }
        muxer.stop()
        muxer.release()
    }

    /** PCM (interleaved 16-bit stereo, 48 kHz) -> AAC-LC 192 kbps samples, kept in memory (about 4 MB for three minutes). */
    private fun encodeAac(pcm: ShortArray): Pair<MediaFormat, List<Pair<ByteArray, MediaCodec.BufferInfo>>> {
        val codec = MediaCodec.createEncoderByType("audio/mp4a-latm")
        val f = MediaFormat.createAudioFormat("audio/mp4a-latm", RATE, 2).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 192_000)
        }
        codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        val samples = ArrayList<Pair<ByteArray, MediaCodec.BufferInfo>>()
        var format: MediaFormat? = null
        val info = MediaCodec.BufferInfo()
        val bytes = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN).also { it.asShortBuffer().put(pcm) }.array()
        var pos = 0
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val ib = codec.getInputBuffer(i)!!
                        ib.clear()
                        val len = minOf(ib.capacity() / 4 * 4, bytes.size - pos)
                        if (len <= 0) {
                            codec.queueInputBuffer(i, 0, 0, pos / 4 * 1_000_000L / RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            ib.put(bytes, pos, len)
                            codec.queueInputBuffer(i, 0, len, pos / 4 * 1_000_000L / RATE, 0)
                            pos += len
                        }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> format = codec.outputFormat
                    o >= 0 -> {
                        val ob = codec.getOutputBuffer(o)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) {
                            val arr = ByteArray(info.size)
                            ob.position(info.offset)
                            ob.get(arr, 0, info.size)
                            samples.add(arr to MediaCodec.BufferInfo().apply { set(0, info.size, info.presentationTimeUs, info.flags) })
                        }
                        codec.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
        } finally {
            try { codec.stop() } catch (_: Exception) { }
            codec.release()
        }
        return Pair(format ?: f, samples)
    }

    companion object {
        @Volatile private var current: ScreenRecorder? = null
        const val RATE = PcmProcessor.RATE
    }
}
