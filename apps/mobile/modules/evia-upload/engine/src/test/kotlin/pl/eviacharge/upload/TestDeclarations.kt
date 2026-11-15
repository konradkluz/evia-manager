package pl.eviacharge.upload

/** Synthetic declaration of a file for the tests (EVM-131): a fixed type and checksum, the name derived from the asset like the app does. */
const val TEST_TYPE = "image/jpeg"
const val TEST_SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

fun declare(
    size: Long,
    assetId: String = "0193a000-0000-7000-8000-00000000000a",
) = FileDeclaration("$assetId.jpg", size, TEST_TYPE, TEST_SHA)
