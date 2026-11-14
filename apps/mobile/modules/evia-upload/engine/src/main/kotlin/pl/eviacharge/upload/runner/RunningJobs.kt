package pl.eviacharge.upload.runner

import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.files.InstanceStopper

/**
 * The jobs that run in this process right now: for each asset its worker thread and its [CancelHandle]. `onStopJob` and the wipe stop
 * a job through it (the handle closes the active connection, the interrupt wakes a sleeping thread). A stop that arrives before the
 * engine of the job is built still takes effect: the handle is created by [begin], before the thread starts, and the engine takes the
 * same handle ([handle]). Thread safe.
 */
class RunningJobs : InstanceStopper {
    private class Slot(
        val thread: Thread,
        val handle: CancelHandle,
    )

    private val slots = LinkedHashMap<String, Slot>()

    /** Registers the worker thread of [assetId] (not started yet) and returns the handle the engine of this job must use. */
    @Synchronized
    fun begin(
        assetId: String,
        thread: Thread,
    ): CancelHandle {
        val handle = CancelHandle()
        slots[assetId] = Slot(thread, handle)
        return handle
    }

    /** The job ended on [thread]; a newer registration of the same asset (another thread) is left alone. */
    @Synchronized
    fun end(
        assetId: String,
        thread: Thread,
    ) {
        if (slots[assetId]?.thread === thread) slots.remove(assetId)
    }

    @Synchronized
    fun handle(assetId: String): CancelHandle? = slots[assetId]?.handle

    @Synchronized
    fun isRunning(assetId: String): Boolean = slots.containsKey(assetId)

    @Synchronized
    fun count(): Int = slots.size

    /** `false` when the asset does not run here. */
    fun stop(assetId: String): Boolean {
        val slot = synchronized(this) { slots[assetId] } ?: return false
        halt(slot)
        return true
    }

    override fun stopAll() {
        synchronized(this) { slots.values.toList() }.forEach { halt(it) }
    }

    private fun halt(slot: Slot) {
        slot.handle.cancel()
        slot.thread.interrupt()
    }
}
