package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import pl.eviacharge.upload.schedule.JobSpec
import pl.eviacharge.upload.schedule.NetworkRequirement
import pl.eviacharge.upload.schedule.SchedulePolicy

/** EVM-130 AC1 (architect 7): the scheduling policy as a pure function. */
class SchedulePolicyTest {
    @Test
    fun `EVM-130 AC1 a user-initiated job only on API 34 or newer with the app visible`() {
        assertEquals(JobSpec(true, NetworkRequirement.ANY, true), SchedulePolicy.decide(34, true, false, false))
        assertEquals(JobSpec(true, NetworkRequirement.ANY, true), SchedulePolicy.decide(35, true, false, false))
        assertFalse(SchedulePolicy.decide(33, true, false, false).userInitiated)
        assertFalse(SchedulePolicy.decide(26, true, false, false).userInitiated)
        assertFalse(SchedulePolicy.decide(34, false, false, false).userInitiated)
    }

    @Test
    fun `EVM-130 AC1 after a SecurityException of the attempt a regular job with a network constraint, persisted`() {
        val spec = SchedulePolicy.decide(34, true, userInitiatedRefused = true, wifiOnly = false)
        assertEquals(JobSpec(false, NetworkRequirement.ANY, true), spec)
        assertEquals(34, SchedulePolicy.USER_INITIATED_MIN_API)
    }

    @Test
    fun `EVM-130 AC1 every job is persisted and has a network requirement, unmetered when videos go over Wi-Fi only`() {
        for (api in listOf(24, 33, 34, 36)) {
            for (visible in listOf(true, false)) {
                for (refused in listOf(true, false)) {
                    for (wifi in listOf(true, false)) {
                        val spec = SchedulePolicy.decide(api, visible, refused, wifi)
                        assertTrue(spec.persisted)
                        assertEquals(if (wifi) NetworkRequirement.UNMETERED else NetworkRequirement.ANY, spec.network)
                        assertEquals(api >= 34 && visible && !refused, spec.userInitiated)
                    }
                }
            }
        }
    }
}
