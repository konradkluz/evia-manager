package pl.eviacharge.upload.http

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/** One request seen by [TestServer]; header names are lower case. The body is kept up to [TestServer.keepBodyBytes]. */
class Seen(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
    val body: ByteArray,
    val bodyLength: Long,
)

class Reply(
    val status: Int,
    val body: String = "",
    val headers: Map<String, String> = emptyMap(),
)

/** A real HTTP server of the JDK on the loopback (no new test dependency): records what it gets and answers as told. */
class TestServer(
    var handler: (Seen) -> Reply = { Reply(200, "{}") },
) : AutoCloseable {
    private val server: HttpServer = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
    val requests = CopyOnWriteArrayList<Seen>()
    var keepBodyBytes = 1 shl 20

    init {
        server.executor = Executors.newCachedThreadPool()
        server.createContext("/") { exchange -> serve(exchange) }
        server.start()
    }

    val port: Int get() = server.address.port
    val origin: String get() = "http://127.0.0.1:$port"
    val authority: String get() = "127.0.0.1:$port"

    private fun serve(exchange: HttpExchange) {
        val kept = java.io.ByteArrayOutputStream()
        var total = 0L
        exchange.requestBody.use { stream ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                total += read
                if (kept.size() < keepBodyBytes) kept.write(buffer, 0, read)
            }
        }
        val headers = exchange.requestHeaders.entries.associate { it.key.lowercase() to it.value.joinToString(",") }
        val seen = Seen(exchange.requestMethod, exchange.requestURI.rawPath, headers, kept.toByteArray(), total)
        requests.add(seen)
        val reply = handler(seen)
        reply.headers.forEach { (name, value) -> exchange.responseHeaders.add(name, value) }
        val bytes = reply.body.toByteArray()
        if (bytes.isEmpty()) {
            exchange.sendResponseHeaders(reply.status, -1)
        } else {
            exchange.sendResponseHeaders(reply.status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        exchange.close()
    }

    override fun close() {
        server.stop(0)
        (server.executor as java.util.concurrent.ExecutorService).shutdownNow()
    }
}
