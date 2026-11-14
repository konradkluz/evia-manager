import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

// Upload engine (EVM-109): pure Kotlin/JVM. The sources are compiled into the Android module by EVM-130 as a source set (no second
// Kotlin Gradle plugin in the APK build); language level 2.2 = Kotlin of React Native 0.88 / Expo 58.
plugins {
    kotlin("jvm") version "2.2.21"
    id("org.jetbrains.kotlinx.kover") version "0.9.11"
}

group = "pl.eviacharge.upload"

val repositoryRoot: Directory = layout.projectDirectory.dir("../../../../..")
val vectorsDirectory: Directory = repositoryRoot.dir("packages/sync-core/conformance/upload")
val thresholdsFile: RegularFile = repositoryRoot.file("packages/config/coverage-thresholds.json")

// The coverage threshold of the engine lives in one place (packages/config/coverage-thresholds.json, key `engine`); a missing key is an error.
val engineThreshold: Int =
    run {
        val file = thresholdsFile.asFile
        if (!file.isFile) throw GradleException("Missing ${file.path}")
        val parsed = JsonSlurper().parse(file) as Map<*, *>
        (parsed["engine"] as? Number)?.toInt() ?: throw GradleException("Missing key `engine` in ${file.path}")
    }

kotlin {
    jvmToolchain(17)
    compilerOptions {
        allWarningsAsErrors.set(true)
        languageVersion.set(KotlinVersion.KOTLIN_2_2)
        apiVersion.set(KotlinVersion.KOTLIN_2_2)
    }
}

val ktlint: Configuration = configurations.create("ktlint")

dependencies {
    // JUnit is EPL-2.0: test scope only, never in the runtime classpath (checkProductionDependencies).
    testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")
    // Single self-contained artifact (MIT), SHA-256 pinned in gradle/verification-metadata.xml.
    ktlint("com.pinterest.ktlint:ktlint-cli:1.8.0:all@jar")
}

tasks.test {
    useJUnitPlatform()
    // A changed vector must rerun the tests (EVM-109 AC4): the directory is a declared input; the test fails when it is missing.
    inputs.dir(vectorsDirectory).withPropertyName("conformanceVectors")
    systemProperty("evia.vectors.dir", vectorsDirectory.asFile.absolutePath)
    systemProperty("evia.module.root", layout.projectDirectory.asFile.absolutePath)
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

val ktlintArguments = listOf("--relative", "src/**/*.kt", "*.kts")

tasks.register<JavaExec>("ktlintCheck") {
    group = "verification"
    description = "ktlint: format and lint of the Kotlin sources (a violation fails the build)."
    classpath = ktlint
    mainClass = "com.pinterest.ktlint.Main"
    args = ktlintArguments
}

tasks.register<JavaExec>("ktlintFormat") {
    group = "formatting"
    description = "ktlint: fixes the violations that can be fixed automatically."
    classpath = ktlint
    mainClass = "com.pinterest.ktlint.Main"
    args = listOf("-F") + ktlintArguments
}

val allowedProductionModules = setOf("org.jetbrains.kotlin:kotlin-stdlib", "org.jetbrains:annotations")

// EVM-109 AC6: the production classpath holds only the Kotlin stdlib and JetBrains annotations (Apache-2.0); JUnit (EPL-2.0) and
// everything else is test or build tooling only.
tasks.register("checkProductionDependencies") {
    group = "verification"
    description = "Fails when the runtime classpath contains anything but kotlin-stdlib and org.jetbrains:annotations."
    val resolved =
        configurations.runtimeClasspath.map { configuration ->
            configuration.incoming.resolutionResult.allComponents
                .mapNotNull { it.moduleVersion }
                .map { "${it.group}:${it.name}" }
        }
    doLast {
        val unexpected = resolved.get().filter { it !in allowedProductionModules && !it.startsWith("pl.eviacharge") }
        if (unexpected.isNotEmpty()) throw GradleException("Disallowed production dependencies: $unexpected")
        println("Production dependencies: ${resolved.get().sorted()}")
    }
}

kover {
    reports {
        total {
            xml { onCheck = false }
        }
        verify {
            rule("engine-line-and-branch") {
                bound {
                    minValue = engineThreshold
                    coverageUnits = kotlinx.kover.gradle.plugin.dsl.CoverageUnit.LINE
                    aggregationForGroup = kotlinx.kover.gradle.plugin.dsl.AggregationType.COVERED_PERCENTAGE
                }
                bound {
                    minValue = engineThreshold
                    coverageUnits = kotlinx.kover.gradle.plugin.dsl.CoverageUnit.BRANCH
                    aggregationForGroup = kotlinx.kover.gradle.plugin.dsl.AggregationType.COVERED_PERCENTAGE
                }
            }
        }
    }
}

tasks.check { dependsOn("ktlintCheck", "checkProductionDependencies") }
