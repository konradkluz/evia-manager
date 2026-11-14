package pl.eviacharge.upload

import kotlin.math.floor

private const val MAX_EXPONENT = 20

/**
 * Full jitter with integer ceilings (identical in TypeScript and Kotlin): the ceiling is `min(cap, base * 2^attempt)` and the delay is
 * `floor(rng * (ceiling + 1))`, `rng` in [0, 1). `attempt` counts from 0.
 */
fun backoffDelayMs(
    attempt: Int,
    rng: Double,
): Long {
    val ceiling = minOf(UploadLimits.CAP_DELAY_MS, UploadLimits.BASE_DELAY_MS * (1L shl attempt.coerceIn(0, MAX_EXPONENT)))
    return floor(rng * (ceiling + 1).toDouble()).toLong()
}
