plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version comes from -PlyraVersion=1.2.3 (the release workflow passes the tag); versionCode is derived from it.
val lyraVersion: String = (project.findProperty("lyraVersion") as String?) ?: "0.1.0"
val lyraVersionCode: Int = lyraVersion.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
    .let { (it.getOrElse(0) { 0 }) * 1_000_000 + (it.getOrElse(1) { 0 }) * 1_000 + it.getOrElse(2) { 0 } }

// Release signing: the workflow provides the key through environment variables. Without them (a contributor's
// own build) the release build falls back to the debug key so `assembleRelease` still works.
val keystorePath: String? = System.getenv("LYRA_KEYSTORE")

android {
    namespace = "dev.lyra.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.lyra.android"
        minSdk = 26
        targetSdk = 36
        versionCode = lyraVersionCode
        versionName = lyraVersion
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("LYRA_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("LYRA_KEY_ALIAS")
                keyPassword = System.getenv("LYRA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
