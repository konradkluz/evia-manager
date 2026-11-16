package pl.eviacharge.upload.schedule

import pl.eviacharge.upload.NetworkGate
import pl.eviacharge.upload.files.AtomicFiles
import java.io.File
import java.io.IOException

/**
 * The setting "videos only over Wi-Fi" (EVM-110 AC4): a single boolean of the phone, native, so that the engine reads it with the app closed.
 * It carries no identifier of a user or a device and is not touched by the sign-out or by the wipe. A missing or unreadable value is `true`
 * (fail closed: the pack of data of the technician is not spent by a failure of the file).
 */
interface UploadSettings {
    fun videoWifiOnly(): Boolean

    /** `true` when the value is durable. */
    fun setVideoWifiOnly(value: Boolean): Boolean

    /** A value held in memory; the default of tests and of a build without a store. */
    class Fixed(
        @Volatile private var value: Boolean,
    ) : UploadSettings {
        override fun videoWifiOnly(): Boolean = value

        override fun setVideoWifiOnly(value: Boolean): Boolean {
            this.value = value
            return true
        }
    }
}

/** The durable store of [UploadSettings]: one tiny file written atomically (`1` / `0`). */
class FileUploadSettings(
    private val file: File,
) : UploadSettings {
    override fun videoWifiOnly(): Boolean = AtomicFiles.read(file, MAX_BYTES)?.let { String(it, Charsets.US_ASCII).trim() } != OFF

    override fun setVideoWifiOnly(value: Boolean): Boolean =
        try {
            AtomicFiles.write(file, (if (value) ON else OFF).toByteArray(Charsets.US_ASCII))
            true
        } catch (error: IOException) {
            false
        }

    private companion object {
        const val ON = "1"
        const val OFF = "0"
        const val MAX_BYTES = 8
    }
}

/**
 * Is the active network free of charges for the transfer (`NET_CAPABILITY_NOT_METERED`)? `null` = unknown (no network, no answer). Read from the
 * capabilities of the network only: no SSID, no `WifiManager`, no location (SEC-110-16).
 */
fun interface UnmeteredCheck {
    fun isUnmetered(): Boolean?
}

/**
 * The network policy of the files (EVM-110 AC4, AC5), pure: only a video (a `video` type) is held back, and only while the setting is on; pictures and
 * entries go through any network. An unknown network counts as "with charges" for a held video (it waits; it is never an error).
 */
class VideoNetworkPolicy(
    private val settings: UploadSettings,
    private val network: UnmeteredCheck,
) {
    fun requiresUnmetered(contentType: String): Boolean = SchedulePolicy.requiresUnmetered(contentType, settings.videoWifiOnly())

    /** The gate the engine asks before every part of a file of [contentType]. */
    fun gateFor(contentType: String): NetworkGate = NetworkGate { !requiresUnmetered(contentType) || network.isUnmetered() == true }

    /** `true` when a file of [contentType] that is not running waits for a network without charges right now. */
    fun waitsForWifi(contentType: String): Boolean = requiresUnmetered(contentType) && network.isUnmetered() != true

    companion object {
        /** No restriction at all: the default of wiring that has no setting (tests). */
        val OPEN = VideoNetworkPolicy(UploadSettings.Fixed(false)) { true }
    }
}
