package pl.eviacharge.upload.http

import java.net.URI
import java.net.URISyntaxException
import java.net.URL

private val STORAGE_HOST = Regex("^[a-z0-9.-]+(:[0-9]{1,5})?$")
private val CLIENT_VERSION = Regex("^[0-9A-Za-z.+-]{1,32}$")

/**
 * The network configuration of the build (EVM-130, ADR-0020, architect 5): the address of the API and the hosts of the storage come
 * from the meta-data of the build, filled in by the config plugin; the JavaScript of the app passes none of them at run time. Only
 * https, no userinfo, no path prefix; the e2e variant ([e2eCleartext], a separate meta-data that `verify` rejects in a release) also
 * allows http and the host of the scenario server. A bad value is an [IllegalArgumentException] without the value in its message.
 */
class HttpConfig(
    apiBaseUrl: String,
    storageHosts: List<String>,
    val clientVersion: String,
    val e2eCleartext: Boolean = false,
    val connectTimeoutMs: Int = DEFAULT_CONNECT_TIMEOUT_MS,
    val readTimeoutMs: Int = DEFAULT_READ_TIMEOUT_MS,
    val maxJsonBytes: Int = MAX_JSON_BYTES,
) {
    /** `scheme://host[:port]` of the API, in lower case, without a trailing slash. */
    val apiOrigin: String

    /** `host[:port]` of the API: the only place the `Authorization` header goes to (exact match). */
    val apiAuthority: String

    /** `host` or `host:port` entries of the storage, lower case. */
    val storageHosts: List<String> = storageHosts.map { it.lowercase() }

    init {
        require(CLIENT_VERSION.matches(clientVersion)) { "invalid client version" }
        require(this.storageHosts.isNotEmpty() && this.storageHosts.all { STORAGE_HOST.matches(it) }) { "invalid storage hosts" }
        require(connectTimeoutMs > 0 && readTimeoutMs > 0 && maxJsonBytes > 0) { "invalid limits" }
        val uri =
            try {
                URI(apiBaseUrl)
            } catch (error: URISyntaxException) {
                throw IllegalArgumentException("invalid api address")
            }
        val scheme = uri.scheme?.lowercase()
        val schemeAllowed = scheme == "https" || (scheme == "http" && e2eCleartext)
        val shapeAllowed =
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
                (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")
        require(schemeAllowed && shapeAllowed && !uri.host.isNullOrEmpty()) { "invalid api address" }
        apiAuthority = (if (uri.port >= 0) "${uri.host}:${uri.port}" else uri.host).lowercase()
        apiOrigin = "$scheme://$apiAuthority"
    }

    /** The URL of an API path (`/api/v1/...`); the path is built by the adapter from checked identifiers. */
    fun apiUrl(path: String): URL {
        require(path.startsWith("/api/v1/")) { "invalid api path" }
        return URL(apiOrigin + path)
    }

    /** The exact match with the host of the API: `Authorization` is added to nothing else. */
    fun isApiUrl(url: URL): Boolean {
        val authority = if (url.port >= 0) "${url.host}:${url.port}" else url.host
        return url.protocol == apiOrigin.substringBefore("://") && authority.lowercase() == apiAuthority
    }

    companion object {
        const val UNKNOWN_CLIENT_VERSION = "0.0.0"

        /**
         * The configuration from the manifest meta-data of the build: the API address, the storage hosts as a comma separated list and
         * the version name of the app (an unusable one becomes [UNKNOWN_CLIENT_VERSION]). A missing or bad value is an
         * [IllegalArgumentException] without the value in its message; the service then does nothing (fail closed).
         */
        fun fromMetaData(
            apiBaseUrl: String?,
            storageHosts: String?,
            versionName: String?,
            e2eCleartext: Boolean,
        ): HttpConfig =
            HttpConfig(
                apiBaseUrl.orEmpty().trim(),
                storageHosts
                    .orEmpty()
                    .split(',')
                    .map { it.trim() }
                    .filter { it.isNotEmpty() },
                versionName?.takeIf { CLIENT_VERSION.matches(it) } ?: UNKNOWN_CLIENT_VERSION,
                e2eCleartext,
            )

        const val DEFAULT_CONNECT_TIMEOUT_MS = 15_000
        const val DEFAULT_READ_TIMEOUT_MS = 30_000

        /** The longest answer of the API that is read (the answers are small: a session, a list of parts, an address). */
        const val MAX_JSON_BYTES = 1024 * 1024
    }
}
