package pl.eviacharge.upload.notification

/** What the notification says: the [text] (from [NotificationText]) and whether it belongs to work in progress. */
data class Notice(
    val text: String,
    /** `true` while a file is being sent (the notification of a running job); `false` for the closing states, which the user may swipe away. */
    val ongoing: Boolean,
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
}
