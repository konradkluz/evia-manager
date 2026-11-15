package pl.eviacharge.upload

import java.net.HttpURLConnection

/**
 * The work was stopped from outside (the system stopped the job, the thread was interrupted, the connection was closed by [CancelHandle],
 * the wipe marker rose). It is NEVER a network failure: the engine does not retry it and does not count it. The snapshot is saved after
 * every step, so the next run continues from the same place. No message: nothing from a connection may leak.
 */
class UploadCancelledException : RuntimeException("cancelled") {
    override fun fillInStackTrace(): Throwable = this
}

/** The original file of a job is gone or shorter than the plan (wiped, deleted by the user). The job ends without a failure and without a path in any log. */
class OriginalMissingException : RuntimeException("original missing") {
    override fun fillInStackTrace(): Throwable = this
}

/**
 * The handle of the running job for `onStopJob`: interrupting a thread does not unblock the I/O of `HttpURLConnection`, so the stop also
 * calls `disconnect()` on the active connection (ADR-0020, architect 3). Thread safe.
 */
class CancelHandle {
    private val lock = Any()
    private var active: HttpURLConnection? = null

    @Volatile
    var cancelled = false
        private set

    /** Registers the connection about to be used; a connection registered after the cancel is closed at once. */
    internal fun attach(connection: HttpURLConnection) {
        synchronized(lock) {
            active = connection
            if (cancelled) connection.disconnect()
        }
    }

    internal fun detach() {
        synchronized(lock) { active = null }
    }

    fun cancel() {
        synchronized(lock) {
            cancelled = true
            active?.disconnect()
        }
    }
}
