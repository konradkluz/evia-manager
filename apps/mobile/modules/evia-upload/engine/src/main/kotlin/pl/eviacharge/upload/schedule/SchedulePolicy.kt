package pl.eviacharge.upload.schedule

/** The network a job needs. A job without a network requirement would run in a garage without a signal and fail at once. */
enum class NetworkRequirement {
    /** Any connection. */
    ANY,

    /** An unmetered connection (Wi-Fi): the option "videos only over Wi-Fi". */
    UNMETERED,
}

/** What the system scheduler is asked for; the glue turns it into a `JobInfo` without any decision of its own. */
data class JobSpec(
    /** A job initiated by the user (UIDT, API 34+): the system lets it run longer and shows it in the task manager. */
    val userInitiated: Boolean,
    val network: NetworkRequirement,
    /** Survives a restart of the phone (`setPersisted(true)`, needs `RECEIVE_BOOT_COMPLETED`). Always true: the queue must not be lost. */
    val persisted: Boolean,
)

/**
 * The scheduling policy as a pure function (architect 7, ADR-0020a): a user-initiated job only on API 34+ and only while the app is
 * visible (the system refuses it otherwise); in every other case, and after a `SecurityException` of such an attempt, a regular job with
 * a network constraint. All jobs are persisted. The glue asks the function, tries what it says and, when the system refuses a
 * user-initiated job, asks again with [userInitiatedRefused].
 */
object SchedulePolicy {
    const val USER_INITIATED_MIN_API = 34

    fun decide(
        apiLevel: Int,
        appVisible: Boolean,
        userInitiatedRefused: Boolean,
        wifiOnly: Boolean,
    ): JobSpec =
        JobSpec(
            userInitiated = apiLevel >= USER_INITIATED_MIN_API && appVisible && !userInitiatedRefused,
            network = if (wifiOnly) NetworkRequirement.UNMETERED else NetworkRequirement.ANY,
            persisted = true,
        )
}
