package pl.eviacharge.upload

private val SESSION_ID = Regex("^[A-Za-z0-9-]{1,64}$")
private val ETAG = Regex("^[A-Za-z0-9\"\\-_=+/.]{1,128}$")

/** Terminal result of a run, thrown from inside the steps. */
private class Stop(
    val outcome: Outcome,
) : Exception(outcome.type) {
    override fun fillInStackTrace(): Throwable = this
}

/** The server says the session cannot continue (`409 invalid_state_transition`: expired, aborted or completed). */
private class SessionGone : Exception() {
    override fun fillInStackTrace(): Throwable = this
}

/** `422 upload_incomplete` on `complete`: a part is missing on the storage (e.g. cleaned up after ListParts); reconcile once more. */
private class UploadIncomplete : Exception() {
    override fun fillInStackTrace(): Throwable = this
}

/** `403` on the address of a part: renew the address of this part only. */
private class UrlExpired : Exception() {
    override fun fillInStackTrace(): Throwable = this
}

private fun attention(reason: AttentionReason) = Stop(Outcome.NeedsAttention(reason))

private class RunContext(
    var snapshot: JobSnapshot,
    var regenerated: Boolean,
    /** True once this run reconciled again after `422 upload_incomplete`; a second one is `needs_attention`. */
    var reconciled: Boolean = false,
)

/** Everything the engine needs from the outside; the adapters (EVM-130) implement the ports. */
class UploadEngineDeps(
    val api: UploadApi,
    val transport: PartTransport,
    val store: JobStore,
    /** Hosts of the storage allowed for part addresses (`host` or `host:port`; the port defaults to 443). */
    val allowedHosts: List<String>,
    val sleeper: Sleeper,
    val random: RandomSource,
    val ids: IdSource,
    val logger: RedactingLogger = RedactingLogger.NONE,
    val checkpoints: CheckpointHook? = null,
    /** The wipe marker (EVM-130): checked before every call. */
    val stop: StopCheck = StopCheck.NEVER,
    /** Part addresses with `http` are accepted only in the e2e variant of the build (EVM-130); never in a release. */
    val allowCleartextPartUrls: Boolean = false,
)

/**
 * Engine of one file upload (EVM-109 AC1, AC2, AC3), a port of the reference model in `packages/sync-core/src/upload`.
 * [run] is safe to call again after any interruption: ListParts is the source of truth for the parts, `complete` is idempotent, the
 * session id and the idempotency key are persisted before the first POST. The engine cannot delete a file or a queue entry; after
 * `device_wipe` the instance sends nothing more. Blocking: the caller runs it on a worker thread.
 */
class UploadEngine(
    private val deps: UploadEngineDeps,
) {
    private var wiped = false

    /**
     * One instance per job, used by one thread. [resume] is the explicit resume of a job paused by `session_revoked`: it is given only
     * after a full sign-in of the same owner (EVM-130, SR-MOB-13); without it a paused job is refused and nothing is sent.
     */
    fun run(
        assetId: String,
        size: Long,
        resume: Boolean = false,
    ): Outcome {
        if (wiped || deps.stop.isStopped()) {
            wiped = true
            return Outcome.DeviceWipe
        }
        var context: RunContext? = null
        val outcome =
            try {
                context = start(assetId, size, resume)
                if (context.snapshot.state == JobState.UPLOADED) return Outcome.Uploaded
                drive(context)
            } catch (stop: Stop) {
                finish(context, stop.outcome)
            }
        deps.logger.event("run_finished", mapOf("outcome" to outcome.type))
        return outcome
    }

    private fun finish(
        context: RunContext?,
        outcome: Outcome,
    ): Outcome {
        if (outcome is Outcome.DeviceWipe) wiped = true
        if (context == null) return outcome
        when (outcome) {
            is Outcome.PausedRevoked -> deps.store.save(context.snapshot.copy(state = JobState.PAUSED_REVOKED))
            is Outcome.RetryChecksum -> deps.store.clear(context.snapshot.assetId)
            else -> Unit
        }
        return outcome
    }

    private fun start(
        assetId: String,
        size: Long,
        resume: Boolean,
    ): RunContext {
        val stored = deps.store.load(assetId)
        if (stored?.state == JobState.PAUSED_REVOKED && !resume) throw Stop(Outcome.PausedRevoked)
        if (stored != null && stored.schemaVersion == SNAPSHOT_SCHEMA_VERSION && stored.size == size) {
            val state = if (stored.state == JobState.UPLOADED) JobState.UPLOADED else JobState.ACTIVE
            return RunContext(stored.copy(state = state), regenerated = false)
        }
        // Nothing stored, an unknown schema version or a changed file: start from the beginning (the server hands back an active session).
        val snapshot = freshSnapshot(assetId, size)
        deps.store.save(snapshot)
        return RunContext(snapshot, regenerated = true)
    }

    private fun freshSnapshot(
        assetId: String,
        size: Long,
    ) = JobSnapshot(
        schemaVersion = SNAPSHOT_SCHEMA_VERSION,
        assetId = assetId,
        size = size,
        uploadSessionId = deps.ids.newId(),
        idempotencyKey = deps.ids.newId(),
        partSize = null,
        partCount = null,
        completeSent = false,
        state = JobState.ACTIVE,
        etags = emptyMap(),
    )

    private fun update(
        context: RunContext,
        change: (JobSnapshot) -> JobSnapshot,
    ) {
        context.snapshot = change(context.snapshot)
        deps.store.save(context.snapshot)
    }

    private fun drive(context: RunContext): Outcome {
        while (true) {
            try {
                val partSize = context.snapshot.partSize ?: openSession(context)
                val plan = plan(context.snapshot.size, partSize, context.snapshot.partCount)
                if (!context.snapshot.completeSent) transfer(context, plan, reconcile(context, plan))
                return complete(context)
            } catch (incomplete: UploadIncomplete) {
                // The mark is withdrawn so that this run (once) and any later run reconcile with ListParts and resend what is missing.
                update(context) { it.copy(completeSent = false) }
                if (context.reconciled) throw attention(AttentionReason.UPLOAD_INCOMPLETE)
                context.reconciled = true
            } catch (gone: SessionGone) {
                if (context.regenerated) throw attention(AttentionReason.INVALID_STATE)
                // Session expired or aborted: one new session per run, with a new id and key, only when the file state allows it.
                context.snapshot = freshSnapshot(context.snapshot.assetId, context.snapshot.size)
                context.regenerated = true
                deps.store.save(context.snapshot)
            }
        }
    }

    private fun plan(
        size: Long,
        partSize: Long,
        partCount: Int?,
    ): List<PartRange> =
        try {
            planParts(size, partSize, partCount ?: 0)
        } catch (mismatch: PlanMismatchException) {
            throw attention(AttentionReason.PLAN_MISMATCH)
        }

    /** Opens (or resumes) the session and returns its part size. */
    private fun openSession(context: RunContext): Long {
        val snapshot = context.snapshot
        val session = call { deps.api.createSession(snapshot.assetId, snapshot.uploadSessionId, snapshot.idempotencyKey) }
        if (!SESSION_ID.matches(session.id)) throw attention(AttentionReason.INVALID_SERVER_RESPONSE)
        plan(snapshot.size, session.partSize, session.partCount)
        // The server may hand back an already active session of this asset (another id): adopt it.
        update(context) { it.copy(uploadSessionId = session.id, partSize = session.partSize, partCount = session.partCount) }
        deps.checkpoints?.reached(Checkpoint.AFTER_SESSION)
        return session.partSize
    }

    /** ListParts is the source of truth. A part counts as sent only when its size equals the expected length. */
    private fun reconcile(
        context: RunContext,
        plan: List<PartRange>,
    ): Set<Int> {
        val listed = call { deps.api.listParts(context.snapshot.uploadSessionId) }
        val done = mutableSetOf<Int>()
        val seen = mutableSetOf<Int>()
        for (part in listed) {
            if (part.partNumber !in 1..plan.size || part.size < 0 || !seen.add(part.partNumber)) {
                throw attention(AttentionReason.INVALID_SERVER_RESPONSE)
            }
            if (part.size == plan[part.partNumber - 1].length) done.add(part.partNumber)
        }
        update(context) { it.copy(etags = it.etags.filterKeys { number -> number.toInt() in done }) }
        return done
    }

    private fun transfer(
        context: RunContext,
        plan: List<PartRange>,
        done: Set<Int>,
    ) {
        for (part in plan) {
            if (part.partNumber in done) continue
            var renewals = 0
            while (true) {
                // The address is fetched right before its part is sent and lives only in memory (SR-FILE-02).
                val target = call { deps.api.partUrl(context.snapshot.uploadSessionId, part.partNumber) }
                if (!isTrustedPartUrl(
                        target.url,
                        deps.allowedHosts,
                        deps.allowCleartextPartUrls,
                    )
                ) {
                    throw attention(AttentionReason.UNTRUSTED_PART_URL)
                }
                if (target.contentLength != part.length) throw attention(AttentionReason.PLAN_MISMATCH)
                val request = PartRequest(target.url, part.offset, part.length, mapOf("Content-Length" to part.length.toString()))
                val etag =
                    try {
                        call(expiredOn403 = true) { deps.transport.put(request) }
                    } catch (expired: UrlExpired) {
                        renewals += 1
                        deps.logger.event("url_renewed", mapOf("part" to part.partNumber.toString(), "attempt" to renewals.toString()))
                        if (renewals > UploadLimits.MAX_RENEWALS) throw attention(AttentionReason.URL_RENEWAL_EXHAUSTED)
                        continue
                    }
                deps.checkpoints?.reached(Checkpoint.AFTER_PART_PUT)
                if (etag != null && !ETAG.matches(etag)) throw attention(AttentionReason.INVALID_SERVER_RESPONSE)
                update(context) { if (etag == null) it else it.copy(etags = it.etags + (part.partNumber.toString() to etag)) }
                deps.logger.event("part_sent", mapOf("part" to part.partNumber.toString()))
                deps.checkpoints?.reached(Checkpoint.AFTER_PART_SAVED)
                break
            }
        }
    }

    private fun complete(context: RunContext): Outcome {
        // The mark is persisted before the request: after a lost answer the next run repeats `complete` (idempotent on the server).
        update(context) { it.copy(completeSent = true) }
        deps.checkpoints?.reached(Checkpoint.BEFORE_COMPLETE)
        val result = call(incompleteOn422 = true) { deps.api.complete(context.snapshot.uploadSessionId) }
        val outcome = mapFailure(result)
        deps.checkpoints?.reached(Checkpoint.AFTER_COMPLETE_BEFORE_SAVE)
        if (outcome != Outcome.Uploaded) throw Stop(outcome)
        update(context) { it.copy(state = JobState.UPLOADED) }
        return outcome
    }

    /** One call with bounded in-process retries; what cannot be retried ends the run through [Stop]. */
    private fun <T> call(
        expiredOn403: Boolean = false,
        incompleteOn422: Boolean = false,
        action: () -> T,
    ): T {
        var attempt = 0
        while (true) {
            if (deps.stop.isStopped()) throw Stop(Outcome.DeviceWipe)
            try {
                return action()
            } catch (error: UploadFailure) {
                val failure = error.failure
                if (failure is Failure.Http && failure.status == 403 && expiredOn403) throw UrlExpired()
                if (failure is Failure.Http && failure.status == 409 && failure.code == "invalid_state_transition") throw SessionGone()
                if (incompleteOn422 && failure is Failure.Http && failure.status == 422 && failure.code in INCOMPLETE_CODES) {
                    throw UploadIncomplete()
                }
                val outcome = mapFailure(failure)
                if (outcome !is Outcome.RetryLater) throw Stop(outcome)
                attempt += 1
                // a `Retry-After` of the server (429) is a floor; a wait longer than the cap of the backoff is left to the system schedule
                val hint = (outcome as Outcome.RetryLater).delayMs ?: 0L
                val delayMs = maxOf(backoffDelayMs(attempt - 1, deps.random.nextDouble()), hint)
                deps.logger.event("retry", mapOf("attempt" to attempt.toString(), "delayMs" to delayMs.toString()))
                if (attempt >= UploadLimits.MAX_ATTEMPTS || delayMs > UploadLimits.CAP_DELAY_MS) throw Stop(Outcome.RetryLater(delayMs))
                deps.sleeper.sleep(delayMs)
            }
        }
    }
}
