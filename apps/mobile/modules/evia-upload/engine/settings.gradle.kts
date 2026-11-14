// Standalone JVM project of the upload engine (EVM-109): no Android, no Expo, tested on the JVM only.
// Supply chain (SR-SUPPLY-04/06): artifacts come from Maven Central only (Google is not needed here), no project-level repositories,
// no JitPack, no Plugin Portal, no automatic JDK download; every artifact has a SHA-256 in gradle/verification-metadata.xml.
pluginManagement {
    repositories {
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        mavenCentral()
    }
}

rootProject.name = "evia-upload-engine"
