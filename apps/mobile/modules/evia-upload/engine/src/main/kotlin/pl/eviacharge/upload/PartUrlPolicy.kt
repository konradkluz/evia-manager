package pl.eviacharge.upload

private const val MAX_URL_LENGTH = 4096
private const val HTTPS = "https://"
private const val HTTP = "http://"
private const val DEFAULT_PORT = "443"
private const val DEFAULT_PORT_HTTP = "80"
private val PRINTABLE_ASCII = 0x21..0x7e
private val HOST = Regex("^[a-z0-9.-]+$")
private val PORT = Regex("^[0-9]{1,5}$")

/**
 * Checks the address of a part before any byte is sent (EVM-109 AC3, MASVS-NETWORK-1): scheme `https`, no userinfo, host exactly from
 * the allowlist (case-insensitive, no suffix or IP tricks), port default (443) or listed explicitly (`host:port`).
 */
fun isTrustedPartUrl(
    url: String,
    allowedHosts: List<String>,
    allowCleartext: Boolean = false,
): Boolean {
    if (url.length > MAX_URL_LENGTH || url.any { it.code !in PRINTABLE_ASCII } || url.contains('\\')) return false
    val cleartext = allowCleartext && url.startsWith(HTTP, ignoreCase = true)
    if (!cleartext && !url.startsWith(HTTPS, ignoreCase = true)) return false
    val rest = url.substring(if (cleartext) HTTP.length else HTTPS.length)
    val end = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }
    val authority = rest.substring(0, if (end < 0) rest.length else end).lowercase()
    if (authority.isEmpty() || authority.contains('@') || authority.startsWith('[')) return false
    val colon = authority.lastIndexOf(':')
    val host = if (colon < 0) authority else authority.substring(0, colon)
    val port = if (colon < 0) "" else authority.substring(colon + 1)
    if (!HOST.matches(host) || (port.isNotEmpty() && !PORT.matches(port))) return false
    val defaultPort = if (cleartext) DEFAULT_PORT_HTTP else DEFAULT_PORT
    val effective = if (port.isEmpty()) defaultPort else port.toInt().toString()
    return allowedHosts.any { matchesEntry(it.lowercase(), host, effective, defaultPort) }
}

/** An entry is `host` (default port only) or `host:port`. */
private fun matchesEntry(
    entry: String,
    host: String,
    port: String,
    defaultPort: String,
): Boolean {
    val at = entry.lastIndexOf(':')
    if (at < 0) return entry == host && port == defaultPort
    return entry.substring(0, at) == host && entry.substring(at + 1) == port
}
