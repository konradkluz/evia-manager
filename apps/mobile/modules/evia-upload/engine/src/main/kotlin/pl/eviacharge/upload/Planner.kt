package pl.eviacharge.upload

data class PartRange(
    val partNumber: Int,
    val offset: Long,
    val length: Long,
)

class PlanMismatchException : Exception("plan_mismatch")

/**
 * Byte ranges of the parts. The server decides the split; the client only computes the ranges and checks the answer:
 * `partCount = ceil(size / partSize)` and `1 <= partCount <= 1000`, otherwise [PlanMismatchException].
 */
fun planParts(
    size: Long,
    partSize: Long,
    partCount: Int,
): List<PartRange> {
    if (size < 1 || partSize < 1 || partCount < 1 || partCount > UploadLimits.MAX_PARTS) throw PlanMismatchException()
    val expected = size / partSize + if (size % partSize == 0L) 0 else 1
    if (expected != partCount.toLong()) throw PlanMismatchException()
    return (0 until partCount).map { index ->
        val offset = index * partSize
        PartRange(index + 1, offset, minOf(partSize, size - offset))
    }
}
