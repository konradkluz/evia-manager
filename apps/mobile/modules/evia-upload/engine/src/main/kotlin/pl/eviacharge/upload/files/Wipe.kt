package pl.eviacharge.upload.files

import pl.eviacharge.upload.StopCheck
import java.io.File
import java.io.IOException

/** Cancels every job of the module in the system scheduler (`JobScheduler.cancel` for each id of [JobIdRegistry]). */
fun interface JobCanceller {
    fun cancelAll()
}

/** Stops the instances of the engine that are running now: interrupts their threads and closes their connections ([pl.eviacharge.upload.CancelHandle]). */
fun interface InstanceStopper {
    fun stopAll()
}

/** Removes the tokens from memory and from the store (the file is removed by the chain too). */
fun interface TokenWiper {
    fun wipe()
}

/** Removes the key of the token store from the Android Keystore (its alias; the key of the database stays with its own module). */
fun interface KeyEraser {
    fun deleteTokenKey()
}

/**
 * The durable marker of the wipe in the base directory (architect 8): "the device must be wiped". The native worker does not read
 * the secure store of Expo, so it has its own. While the marker is set nothing is sent (checked before every call, [isStopped]); it is
 * cleared only by a full sign-in AFTER the cleaning finished ([clearAfterLogin]). An unreadable marker counts as "cleaning" (fail closed).
 */
class WipeMarker(
    private val file: File,
) : StopCheck {
    enum class State { NONE, CLEANING, CLEANED }

    fun state(): State {
        if (!file.exists()) return State.NONE
        val text = AtomicFiles.read(file, MAX_BYTES)?.toString(Charsets.UTF_8)
        return if (text == CLEANED_TEXT) State.CLEANED else State.CLEANING
    }

    override fun isStopped(): Boolean = file.exists()

    @Throws(IOException::class)
    fun begin() = AtomicFiles.write(file, CLEANING_TEXT.toByteArray(Charsets.UTF_8))

    @Throws(IOException::class)
    fun markCleaned() = AtomicFiles.write(file, CLEANED_TEXT.toByteArray(Charsets.UTF_8))

    /** A full sign-in happened: the marker goes only when the cleaning is finished. `false` = the cleaning is not done, work stays blocked. */
    @Throws(IOException::class)
    fun clearAfterLogin(): Boolean {
        if (state() == State.CLEANING) return false
        AtomicFiles.delete(file)
        return true
    }

    private companion object {
        const val CLEANING_TEXT = "cleaning"
        const val CLEANED_TEXT = "cleaned"
        const val MAX_BYTES = 64
    }
}

/**
 * The cleaning of the device in the order of the architect (8) and of the security review (A3): the marker first, then the jobs of the
 * system are cancelled, the running instances stop, and only then the files go (job files, originals, the camera cache, temporary files, the token store)
 * and the key alias. Every step is idempotent and a failed step does not stop the others: [run] returns `false` when something stayed,
 * the marker then stays at "cleaning" and [run] is called again (at the next start of the app or of the service).
 */
class WipeChain(
    private val files: UploadFiles,
    private val marker: WipeMarker,
    private val canceller: JobCanceller,
    private val stopper: InstanceStopper,
    private val tokens: TokenWiper,
    private val keys: KeyEraser,
    private val ids: JobIdRegistry,
) {
    /** True when everything is removed and the marker says "cleaned". @throws IOException when the marker cannot be written (nothing started). */
    @Throws(IOException::class)
    fun run(): Boolean {
        // the marker is the first step; if it cannot be written the cleaning does not start (nothing is claimed that is not durable)
        if (marker.state() == WipeMarker.State.NONE) marker.begin()
        val clean =
            listOf(
                { canceller.cancelAll() },
                { stopper.stopAll() },
                { check(AtomicFiles.deleteTree(files.jobsDirectory)) },
                { check(AtomicFiles.deleteTree(files.originalsDirectory)) },
                // the pictures the camera left in the cache of the app are not in the originals: they go too (EVM-108, fail closed)
                { check(CaptureCache.deleteTree(files.cameraDirectory)) },
                { AtomicFiles.temporaryFiles(files.root).forEach { AtomicFiles.delete(it) } },
                { tokens.wipe() },
                { AtomicFiles.delete(files.tokenFile) },
                { keys.deleteTokenKey() },
                { ids.forget() },
                { AtomicFiles.delete(files.contactFile) },
            ).map { step -> attempt(step) }
        if (clean.any { !it }) return false
        marker.markCleaned()
        return true
    }

    /** At the start of the app or of the service: a marker left by an interrupted cleaning finishes the cleaning. */
    @Throws(IOException::class)
    fun finishIfPending(): Boolean = if (marker.state() == WipeMarker.State.CLEANING) run() else marker.state() == WipeMarker.State.CLEANED

    private fun attempt(step: () -> Unit): Boolean =
        try {
            step()
            true
        } catch (error: IOException) {
            false
        } catch (error: IllegalStateException) {
            false
        } catch (error: RuntimeException) {
            false
        }
}
