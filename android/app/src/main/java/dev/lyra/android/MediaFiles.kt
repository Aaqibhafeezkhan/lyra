package dev.lyra.android

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.security.MessageDigest

/**
 * The user's own background videos / GIFs / images. They are copied into the app's private folder under a hashed
 * name (nothing outside it is ever read later) and served to the page from https://appassets.../bg/<name>.
 */
object MediaFiles {
    private const val MAX_BYTES = 200L * 1024 * 1024
    private val NAME = Regex("^[a-f0-9]{16}\\.(mp4|webm|gif|png|jpg|webp)$")
    private val EXT = mapOf(
        "video/mp4" to "mp4", "video/webm" to "webm", "image/gif" to "gif",
        "image/png" to "png", "image/jpeg" to "jpg", "image/webp" to "webp"
    )
    private val MIME = mapOf("mp4" to "video/mp4", "webm" to "video/webm", "gif" to "image/gif", "png" to "image/png", "jpg" to "image/jpeg", "webp" to "image/webp")

    private fun dir(ctx: Context): File = File(ctx.filesDir, "backgrounds").apply { mkdirs() }

    /** Copy a picked document in. Runs on a background thread. */
    fun import(ctx: Context, uri: Uri): JSONObject {
        val mime = ctx.contentResolver.getType(uri) ?: ""
        val ext = EXT[mime] ?: return fail("Use an MP4, WebM, GIF, PNG, JPG or WebP file.")
        val name = ctx.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: "background.$ext"
        val tmp = File(dir(ctx), "incoming.tmp")
        val md = MessageDigest.getInstance("SHA-256")
        var total = 0L
        try {
            ctx.contentResolver.openInputStream(uri)?.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) {
                            tmp.delete()
                            return fail("That file is over the 200 MB limit.")
                        }
                        md.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            } ?: return fail("Couldn’t read that file.")
        } catch (e: Exception) {
            tmp.delete()
            return fail("Couldn’t read that file.")
        }
        val file = md.digest().take(8).joinToString("") { "%02x".format(it) } + "." + ext
        val dest = File(dir(ctx), file)
        if (dest.exists()) tmp.delete() else tmp.renameTo(dest)
        return JSONObject().put("ok", true).put("file", file).put("name", name.take(120)).put("kind", if (ext == "mp4" || ext == "webm") "video" else "image")
    }

    fun delete(ctx: Context, file: String) {
        if (NAME.matches(file)) File(dir(ctx), file).delete()
    }

    private fun fail(msg: String) = JSONObject().put("ok", false).put("error", msg)

    /** Serve /bg/<name> with HTTP Range support, which video looping and seeking need. */
    fun serve(ctx: Context, name: String, request: WebResourceRequest): WebResourceResponse {
        val file = File(dir(ctx), name)
        if (!NAME.matches(name) || !file.exists()) return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())
        val mime = MIME[name.substringAfterLast('.')] ?: "application/octet-stream"
        val len = file.length()
        val range = request.requestHeaders["Range"]?.let { Regex("bytes=(\\d*)-(\\d*)").find(it) }
        val start = range?.groupValues?.get(1)?.toLongOrNull() ?: 0L
        val end = range?.groupValues?.get(2)?.toLongOrNull()?.coerceAtMost(len - 1) ?: (len - 1)
        val partial = range != null && start <= end
        val from = if (partial) start else 0L
        val to = if (partial) end else len - 1
        val raf = RandomAccessFile(file, "r").apply { seek(from) }
        val stream = object : InputStream() {
            var left = to - from + 1
            override fun read(): Int {
                if (left <= 0) return -1
                left--
                return raf.read()
            }

            override fun read(b: ByteArray, off: Int, n: Int): Int {
                if (left <= 0) return -1
                val r = raf.read(b, off, minOf(n.toLong(), left).toInt())
                if (r > 0) left -= r
                return r
            }

            override fun close() = raf.close()
        }
        val headers = mutableMapOf("Accept-Ranges" to "bytes", "Content-Length" to (to - from + 1).toString(), "Access-Control-Allow-Origin" to Rpc.ASSET_ORIGIN)
        if (partial) headers["Content-Range"] = "bytes $from-$to/$len"
        return WebResourceResponse(mime, null, if (partial) 206 else 200, if (partial) "Partial Content" else "OK", headers, stream)
    }
}
