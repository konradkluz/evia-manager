package pl.eviacharge.upload.android

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.RedactingLogger
import pl.eviacharge.upload.files.BootIds
import pl.eviacharge.upload.files.ClockReading
import pl.eviacharge.upload.files.ClockReadings
import pl.eviacharge.upload.files.ContactMarker
import pl.eviacharge.upload.files.JobCanceller
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.JobIdRegistry
import pl.eviacharge.upload.files.TokenWiper
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.files.WipeChain
import pl.eviacharge.upload.files.WipeMarker
import pl.eviacharge.upload.http.HttpAuthApi
import pl.eviacharge.upload.http.HttpConfig
import pl.eviacharge.upload.http.HttpCore
import pl.eviacharge.upload.http.UploadSetup
import pl.eviacharge.upload.runner.EngineFactory
import pl.eviacharge.upload.runner.JobOutcomes
import pl.eviacharge.upload.runner.JobResult
import pl.eviacharge.upload.runner.JobStatus
import pl.eviacharge.upload.runner.ProgressStore
import pl.eviacharge.upload.runner.ProgressThrottle
import pl.eviacharge.upload.runner.RunningJobs
import pl.eviacharge.upload.runner.UploadJobRunner
import pl.eviacharge.upload.runner.UploadReporter
import pl.eviacharge.upload.runner.UploadWorker
import pl.eviacharge.upload.schedule.JobArming
import pl.eviacharge.upload.schedule.JobLifecycle
import pl.eviacharge.upload.session.FileTokenVault
import pl.eviacharge.upload.session.JceRecordCipher
import pl.eviacharge.upload.session.MonotonicClock
import pl.eviacharge.upload.session.SessionState
import pl.eviacharge.upload.session.TokenOwner
import java.io.File
import java.io.IOException

/** The names of the build configuration in the manifest (written by `plugins/with-upload.ts`; `tools/mobile-apk verify` checks them). */
internal object BuildConfigNames {
  const val API_BASE_URL = "pl.eviacharge.API_BASE_URL"
  const val STORAGE_HOSTS = "pl.eviacharge.STORAGE_HOSTS"
  const val UPLOAD_E2E_CLEARTEXT = "pl.eviacharge.UPLOAD_E2E_CLEARTEXT"
}

/** Receives the events of the upload for the app (JavaScript); set only while the JavaScript side listens. */
fun interface EventSink {
  fun emit(
    name: String,
    body: Map<String, Any?>,
  )
}

/** The readings of the clocks of the phone for the mark of the last contact; the boot id has the form of the JavaScript side. */
internal class AndroidClockReadings(
  private val context: Context,
) : ClockReadings {
  override fun read(): ClockReading {
    val wall = System.currentTimeMillis()
    val mono = SystemClock.elapsedRealtime()
    val count =
      try {
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
      } catch (error: RuntimeException) {
        -1
      }
    return ClockReading(wall, mono, BootIds.of(count, wall, mono))
  }
}

/**
 * Everything of the upload in this process, built once (EVM-130 AC2): ONE [TokenOwner], one lock, shared by the module for the app and by
 * the job service (the foreground and the job never refresh twice); the queue of files in `noBackupFilesDir` (credential-encrypted
 * storage, never device-protected, external or MediaStore); the build configuration from the manifest meta-data. This is wiring only:
 * every object is a pure class of the engine with a port filled in here. A missing API address throws [IllegalStateException] without
 * the value (fail closed: the service does nothing, the module answers "unavailable"); missing storage hosts only switch the upload off
 * ([uploadEnabled]) - the session keeps working.
 * Logs: none. The engine writes through the redacting logger and this glue gives it no sink (a sink needs an exception in
 * `tools/repo-policy` and a review); `android.util.Log` is forbidden in module sources.
 */
class UploadRuntime private constructor(
  context: Context,
) {
  private val app: Context = context.applicationContext
  val files = UploadFiles(File(app.noBackupFilesDir, "evia-upload"))
  val marker = WipeMarker(files.wipeMarkerFile)
  val contact = ContactMarker(files.contactFile, AndroidClockReadings(app))
  val ids = JobIdRegistry(files.jobIdsFile)
  val jobs = JobFileStore(files)
  val running = RunningJobs()
  /** What the build configures (the pure `HttpConfig.setupFromMetaData`): the session needs the API address, the upload also the storage hosts. */
  private val setup: UploadSetup = readSetup(app)
  val config: HttpConfig = setup.config ?: throw IllegalStateException("upload is not configured")

  /** `false` in a build without storage hosts: the session works, the functions that send files answer "upload_unavailable". */
  val uploadEnabled: Boolean = setup.uploadEnabled
  val keys = TokenKeystore()
  val system = AndroidSystemJobs(app)
  val notifications = UploadNotifications(app)

  private val authCore = HttpCore(config, CancelHandle(), marker)
  private val auth = HttpAuthApi(authCore)
  val tokens = TokenOwner(
    FileTokenVault(files.tokenFile, JceRecordCipher { keys.key() }),
    auth,
    MonotonicClock { SystemClock.elapsedRealtime() },
    auth,
    contact,
  )

  /** Where the events go; the module sets it while it is alive. The job service works with or without it. */
  @Volatile
  var events: EventSink? = null

  private val reporter = object : UploadReporter {
    override fun progress(status: JobStatus) {
      emit(
        "onUploadProgress",
        mapOf(
          "assetId" to status.assetId,
          "state" to status.state.wire,
          "partsDone" to status.partsDone,
          "partCount" to status.partCount,
          "percent" to status.percent,
          "sizeBytes" to status.sizeBytes.toDouble(),
        ),
      )
    }

    override fun finished(
      assetId: String,
      result: JobResult,
      session: SessionState?,
    ) {
      val (state, reason) = JobOutcomes.fileState(result)
      emit("onFileState", mapOf("assetId" to assetId, "state" to state, "reason" to reason))
      if (session != null) emit("onSessionState", mapOf("state" to JobOutcomes.sessionWire(session)))
    }
  }

  private val store = ProgressStore(jobs, ProgressThrottle({ SystemClock.elapsedRealtime() })) { reporter.progress(it) }
  private val factory = EngineFactory(config, tokens, files, store, marker, contact, running, logger = RedactingLogger.NONE)
  val worker = UploadWorker(UploadJobRunner(jobs, tokens, marker, factory::create, RedactingLogger.NONE), jobs, running, marker, tokens, reporter)
  val arming = JobArming(files, jobs, ids, system, marker, Build.VERSION.SDK_INT) { appVisible }
  val lifecycle = JobLifecycle(files, ids, system, running)
  private val wipeChain = WipeChain(
    files,
    marker,
    JobCanceller { ids.allIds().forEach { system.cancel(it) } },
    running,
    TokenWiper { tokens.wipe() },
    keys,
    ids,
  )

  /** `true` while an activity of the app is visible; the module keeps it (the system allows a user-initiated job only then). */
  @Volatile
  var appVisible: Boolean = false

  init {
    // a wipe interrupted by a killed process finishes now, before anything is sent; then the stored session is loaded
    try {
      wipeChain.finishIfPending()
    } catch (error: IOException) {
      // the marker stays and blocks every request; the next start tries again
    }
    tokens.load()
  }

  private fun emit(
    name: String,
    body: Map<String, Any?>,
  ) {
    try {
      events?.emit(name, body)
    } catch (error: RuntimeException) {
      // nobody listens: the work does not depend on it
    }
  }

  /** The whole wipe step of the work files and the token store (the single call before `confirmDeviceWipe`); `false` = something stayed, call again. */
  fun wipe(): Boolean =
    try {
      wipeChain.run()
    } catch (error: IOException) {
      false
    }

  companion object {
    @Volatile
    private var instance: UploadRuntime? = null

    fun get(context: Context): UploadRuntime =
      instance ?: synchronized(this) {
        instance ?: UploadRuntime(context).also { instance = it }
      }

    private fun readSetup(app: Context): UploadSetup {
      try {
        val manager = app.packageManager
        val info =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            manager.getApplicationInfo(app.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
          } else {
            @Suppress("DEPRECATION")
            manager.getApplicationInfo(app.packageName, PackageManager.GET_META_DATA)
          }
        val version =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            manager.getPackageInfo(app.packageName, PackageManager.PackageInfoFlags.of(0L)).versionName
          } else {
            @Suppress("DEPRECATION")
            manager.getPackageInfo(app.packageName, 0).versionName
          }
        val meta = info.metaData
        return HttpConfig.setupFromMetaData(
          meta?.get(BuildConfigNames.API_BASE_URL)?.toString(),
          meta?.get(BuildConfigNames.STORAGE_HOSTS)?.toString(),
          version,
          meta?.containsKey(BuildConfigNames.UPLOAD_E2E_CLEARTEXT) == true,
        )
      } catch (error: Exception) {
        // never the value or the text of the failure
        throw IllegalStateException("upload is not configured")
      }
    }
  }
}
