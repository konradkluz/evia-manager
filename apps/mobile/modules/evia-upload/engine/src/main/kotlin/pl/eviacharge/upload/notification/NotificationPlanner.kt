package pl.eviacharge.upload.notification

/** What the notification says: the [text] (from [NotificationText]) and whether it belongs to work in progress. */
data class Notice(
    val text: String,
    /** `true` while a file is being sent (the notification of a running job); `false` for the closing states, which the user may swipe away. */
    val ongoing: Boolean,
)

/**
 * What the service does with the notification of one job: the [notice] to show, whether the system keeps it after the job ends (a
 * closing state: all sent, failed, paused) and whether an ordinary notification of a regular job is withdrawn (nothing to say).
 */
data class JobNotification(
    val notice: Notice,
    val keepAfterJob: Boolean,
    val withdraw: Boolean,
)

/**
 * Chooses the notification from counts only (EVM-130 AC6): no order numbers, names or addresses can get in because none is an input.
 * While a job runs the progress is shown; afterwards the closing state: paused for the sign-in, failed files, or all files sent. Nothing
 * to say (an empty queue, files that wait for the network) gives `null` - waiting for Wi-Fi is not an error.
 */
object NotificationPlanner {
    fun plan(
        total: Int,
        done: Int,
        failed: Int,
        paused: Boolean,
        running: Boolean,
    ): Notice? =
        when {
            running -> Notice(NotificationText.progress(minOf(done, maxOf(total, 1)), maxOf(total, 1)), true)
            paused -> Notice(NotificationText.PAUSED, false)
            failed > 0 -> Notice(NotificationText.failed(failed), false)
            total > 0 && done >= total -> Notice(NotificationText.sent(done), false)
            else -> null
        }

    /**
     * A user-initiated job must always have a notification while it runs, so "nothing to say" becomes a progress text that the system
     * removes with the job; a regular job withdraws its notification instead.
     */
    fun forJob(
        current: Notice?,
        userInitiated: Boolean,
    ): JobNotification =
        JobNotification(
            notice = current ?: Notice(NotificationText.progress(0, 1), true),
            keepAfterJob = current != null && !current.ongoing,
            withdraw = !userInitiated && current == null,
        )
}
