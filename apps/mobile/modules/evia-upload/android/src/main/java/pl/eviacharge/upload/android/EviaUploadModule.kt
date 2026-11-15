package pl.eviacharge.upload.android

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.runner.JobOutcomes
import pl.eviacharge.upload.runner.JobStatus
import pl.eviacharge.upload.http.UploadUnavailable
import pl.eviacharge.upload.schedule.JobArming
import pl.eviacharge.upload.schedule.SyntheticFile
import pl.eviacharge.upload.schedule.wire
import pl.eviacharge.upload.session.AppAccess
import pl.eviacharge.upload.session.LoginInput
import java.io.IOException

/**
 * The bridge between the JavaScript of the app and the native upload (EVM-130; ADR-0020/0020a). Every function only converts and calls
 * the pure engine through [UploadRuntime]; the decisions (what a state means, what an answer says) are in the engine and tested on the
 * JVM. The contract with JavaScript (full list in `modules/evia-upload/README.md`, types in `src/index.ts`):
 * - NO function returns a refresh token or a revocation token. Tokens go IN once (`stageLogin` / `commitLogin`, write only); out comes
 *   the access token and how long it holds (`accessToken`);
 * - the bytes of a file never cross the bridge: the original lies in `noBackupFilesDir` under the name of its UUID, the digest is computed
 *   here as a stream;
 * - no exception text is returned: a failure is a short code (`unavailable`, `invalid`, `storage_failed`, ...) or `false` / `null`;
 * - events (`onUploadProgress` throttled to one per second per file, `onFileState`, `onSessionState`) go out only while this module lives.
 * When the build carries no valid upload configuration ([UploadRuntime] cannot be built) every function answers `unavailable`.
 */
class EviaUploadModule : Module() {
  private val context: Context? get() = appContext.reactContext

  private fun runtime(): UploadRuntime? =
    try {
      context?.let { UploadRuntime.get(it) }
    } catch (error: Throwable) {
      null
    }

  private fun <T> withRuntime(
    fallback: T,
    block: (UploadRuntime) -> T,
  ): T {
    val runtime = runtime() ?: return fallback
    return try {
      block(runtime)
    } catch (error: Throwable) {
      fallback
    }
  }

  /** For the functions that send files: without storage hosts in the build the answer is [fallback] and nothing touches the network. */
  private fun <T> withUpload(
    fallback: T,
    block: (UploadRuntime) -> T,
  ): T = withRuntime(fallback) { rt -> if (rt.uploadEnabled) block(rt) else fallback }

  private fun JobStatus.toMap(): Map<String, Any?> =
    mapOf(
      "assetId" to assetId,
      "state" to state.wire,
      "partsDone" to partsDone,
      "partCount" to partCount,
      "percent" to percent,
      "sizeBytes" to sizeBytes.toDouble(),
    )

  /** The target of the notification that arrived with `onNewIntent` (read once by `launchTarget`). */
  @Volatile private var newIntentTarget: String? = null

  override fun definition() = ModuleDefinition {
    Name("EviaUpload")

    Events("onUploadProgress", "onFileState", "onSessionState")

    OnCreate {
      runtime()?.let {
        it.events = EventSink { name, body -> sendEvent(name, body) }
        // the module is created with the visible activity; the foreground and background callbacks keep the flag from here on
        it.appVisible = appContext.currentActivity != null
      }
    }

    OnDestroy {
      runtime()?.events = null
    }

    OnActivityEntersForeground {
      runtime()?.appVisible = true
    }

    OnActivityEntersBackground {
      runtime()?.appVisible = false
    }

    // a touch of the notification while the app runs (warm start, `singleTask`): the activity gets `onNewIntent`, its `getIntent()`
    // keeps the intent of the first start; the allowed value is kept here until `launchTarget` reads it once
    OnNewIntent { intent ->
      try {
        val target = intent.getStringExtra(UploadNotifications.EXTRA_TARGET)
        intent.removeExtra(UploadNotifications.EXTRA_TARGET)
        newIntentTarget = target?.takeIf { it in UploadNotifications.TARGETS }
      } catch (error: Throwable) {
        newIntentTarget = null
      }
    }

    // ---- session: the tokens go in, only the access token comes out ----

    /** Step 2 of the sign-in while the device check runs. Resolves `ok` | `invalid` | `unavailable`. The refresh token is write-only. */
    AsyncFunction("stageLogin") { userId: String, deviceId: String, refreshToken: String, accessToken: String, accessValidForMs: Double, serverTimeMs: Double? ->
      withRuntime("unavailable") { rt ->
        val owner = LoginInput.ownerOf(userId, deviceId, refreshToken, accessToken, accessValidForMs.toLong())
        if (owner == null) {
          "invalid"
        } else {
          rt.tokens.stageLogin(owner, refreshToken, accessToken, accessValidForMs.toLong(), serverTimeMs?.toLong())
          "ok"
        }
      }
    }

    /** The device check went on: the staged session is stored. Resolves `ok` | `storage_failed` | `nothing_staged` | `unavailable`. */
    AsyncFunction("commitStaged") { sameInstallation: Boolean ->
      withRuntime("unavailable") { rt ->
        try {
          rt.tokens.commitStaged(sameInstallation)
          "ok"
        } catch (error: IOException) {
          "storage_failed"
        } catch (error: IllegalStateException) {
          "nothing_staged"
        }
      }
    }

    /** The device check was cancelled: the staged session is ended. Resolves `ok` | `unavailable`. */
    AsyncFunction("abandonStaged") {
      withRuntime("unavailable") { rt ->
        rt.tokens.abandonStaged()
        "ok"
      }
    }

    /** Step 2 of the sign-in without a device check in between. Resolves `ok` | `invalid` | `storage_failed` | `unavailable`. */
    AsyncFunction("commitLogin") { userId: String, deviceId: String, refreshToken: String, accessToken: String, accessValidForMs: Double, sameInstallation: Boolean, serverTimeMs: Double? ->
      withRuntime("unavailable") { rt ->
        val owner = LoginInput.ownerOf(userId, deviceId, refreshToken, accessToken, accessValidForMs.toLong())
        if (owner == null) {
          "invalid"
        } else {
          try {
            rt.tokens.commitLogin(owner, refreshToken, accessToken, accessValidForMs.toLong(), sameInstallation, serverTimeMs?.toLong())
            "ok"
          } catch (error: IOException) {
            "storage_failed"
          }
        }
      }
    }

    /**
     * An access token for a request of the app; the refresh is single-flight natively. [rejected] = the access token the server refused
     * with `401`. Resolves `{status: "ready", accessToken, ownerId, validForMs}` | `{status: "retry_later"}` | `{status: "blocked", state}`
     * | `{status: "unavailable"}`.
     */
    AsyncFunction("accessToken") { rejected: String? ->
      withRuntime<Map<String, Any?>>(mapOf("status" to "unavailable")) { rt ->
        when (val access = rt.tokens.accessForApp(rejected)) {
          is AppAccess.Ready -> mapOf(
            "status" to "ready",
            "accessToken" to access.accessToken,
            "ownerId" to access.ownerId,
            "validForMs" to access.validForMs.toDouble(),
          )
          AppAccess.RetryLater -> mapOf("status" to "retry_later")
          is AppAccess.Blocked -> mapOf("status" to "blocked", "state" to JobOutcomes.sessionWire(access.state))
        }
      }
    }

    /** The API (called by JavaScript) answered `401 session_revoked`: the tokens go, the work pauses. */
    AsyncFunction("reportApiRevoked") {
      withRuntime(false) { rt ->
        rt.tokens.onApiRevoked()
        true
      }
    }

    /** The API answered `401 device_wipe_required`. */
    AsyncFunction("reportDeviceWipeRequired") {
      withRuntime(false) { rt ->
        rt.tokens.onApiWipeRequired()
        true
      }
    }

    /** The API answered `426`: the work waits for an update of the app. */
    AsyncFunction("reportUpdateRequired") {
      withRuntime(false) { rt ->
        rt.tokens.onApiUpdateRequired()
        true
      }
    }

    /** "Log out": the session ends at once; online, the server is asked to end it (pending revocations are kept). Resolves `true` | `false`. */
    AsyncFunction("signOut") { online: Boolean ->
      withRuntime(false) { rt ->
        rt.tokens.signOut(online)
        true
      }
    }

    /** Sends the pending revocations (start, return of the network, after a sign-in). Resolves `true` | `false`. */
    AsyncFunction("flushPendingRevocations") {
      withRuntime(false) { rt ->
        rt.tokens.flushPendingRevocations()
        true
      }
    }

    /** `{state, ownerId}`: `signed_out` | `signed_in` | `needs_login` | `paused_revoked` | `paused_update` | `wipe_required` (`unavailable` without the configuration). */
    AsyncFunction("sessionState") {
      withRuntime<Map<String, Any?>>(mapOf("state" to "unavailable", "ownerId" to null)) { rt ->
        mapOf("state" to JobOutcomes.sessionWire(rt.tokens.state()), "ownerId" to rt.tokens.currentOwnerId())
      }
    }

    /** After a FULL sign-in: the wipe marker goes when the cleaning is finished. Resolves `true` when work may start. */
    AsyncFunction("clearWipeMarkerAfterLogin") {
      withRuntime(false) { rt ->
        try {
          rt.marker.clearAfterLogin()
        } catch (error: IOException) {
          false
        }
      }
    }

    // ---- files and jobs ----

    /** The private place of the original of [assetId] (a lower-case UUID): where the camera writes it. `null` for a bad identifier. */
    AsyncFunction("originalPath") { assetId: String ->
      withRuntime<String?>(null) { rt -> rt.lifecycle.originalFile(assetId).absolutePath }
    }

    /** `{sizeBytes, sha256}` of the original, computed natively as a stream; `null` when there is none. */
    AsyncFunction("digestOriginal") { assetId: String ->
      withRuntime<Map<String, Any?>?>(null) { rt ->
        rt.lifecycle.digest(assetId)?.let { mapOf("sizeBytes" to it.sizeBytes.toDouble(), "sha256" to it.sha256Hex) }
      }
    }

    /**
     * Arms the job of a file once the server applied `CreateMediaAsset` (idempotent). Resolves `armed_user_initiated` | `armed` |
     * `already_armed` | `missing_original` | `invalid` | `wipe_active` | `failed` | `upload_unavailable` (no storage hosts in the build) | `unavailable`.
     */
    AsyncFunction("armUpload") { assetId: String, workOrderId: String, userId: String, deviceId: String, wifiOnly: Boolean, contentType: String? ->
      withUpload(UploadUnavailable.WIRE) { rt ->
        rt.arming.arm(JobArming.Item(assetId, workOrderId, userId, deviceId, contentType.orEmpty()), wifiOnly).wire()
      }
    }

    /** Arms every file of the list (start, return to the foreground, after a sign-in). Items: `{assetId, workOrderId, userId, deviceId, contentType}` (`contentType` = the MIME type of the file; the module declares it in the upload session). */
    AsyncFunction("reconcile") { items: List<Map<String, String>>, wifiOnly: Boolean ->
      withUpload(UploadUnavailable.reconcile(items.map { it["assetId"].orEmpty() })) { rt ->
        val list = items.map { JobArming.Item(it["assetId"].orEmpty(), it["workOrderId"].orEmpty(), it["userId"].orEmpty(), it["deviceId"].orEmpty(), it["contentType"].orEmpty()) }
        rt.arming.reconcile(list, wifiOnly).mapValues { it.value.wire() }
      }
    }

    /** "Ponów": the same job is handed to the system again. Same answers as `armUpload`. */
    AsyncFunction("retryUpload") { assetId: String, wifiOnly: Boolean ->
      withUpload(UploadUnavailable.WIRE) { rt -> rt.arming.retry(assetId, wifiOnly).wire() }
    }

    /** The user cancels a file: the job stops and goes; the original only when [deleteOriginal]. Resolves `true` when everything was removed. */
    AsyncFunction("cancelUpload") { assetId: String, deleteOriginal: Boolean ->
      withRuntime(false) { rt ->
        val done = rt.lifecycle.cancel(assetId, deleteOriginal)
        rt.worker.forget(assetId)
        done
      }
    }

    /**
     * The server told the state of the file in its replica: the original and the job go only for a confirmed file. Resolves the verdict
     * `delete` | `keep` | `keep_and_retry` | `keep_quarantined` (`invalid` | `unavailable`).
     */
    AsyncFunction("completeUpload") { assetId: String, serverState: String, reasonCode: String? ->
      withRuntime("unavailable") { rt ->
        if (!UploadFiles.isAssetId(assetId)) {
          "invalid"
        } else {
          val verdict = rt.lifecycle.complete(assetId, serverState, reasonCode)
          rt.worker.forget(assetId)
          verdict.name.lowercase()
        }
      }
    }

    /** The status of every file on the native side: `{assetId, state, partsDone, partCount, percent, sizeBytes}`. */
    AsyncFunction("uploadStatuses") {
      withUpload<List<Map<String, Any?>>>(emptyList()) { rt -> rt.worker.statuses().map { it.toMap() } }
    }

    /** The whole step of the wipe before `confirmDeviceWipe`: marker, jobs, files, token store and key. Resolves `true` when everything is gone. */
    AsyncFunction("wipeUploads") {
      withRuntime(false) { rt -> rt.wipe() }
    }

    /** The mark of the last successful authenticated contact with the API (also from the background): `{wallMs, monoMs, bootId, serverTimeMs}` or `null`. */
    AsyncFunction("lastContact") {
      withRuntime<Map<String, Any?>?>(null) { rt ->
        rt.contact.read()?.let {
          mapOf("wallMs" to it.wallMs.toDouble(), "monoMs" to it.monoMs.toDouble(), "bootId" to it.bootId, "serverTimeMs" to it.serverTimeMs?.toDouble())
        }
      }
    }

    // ---- notifications ----

    /** `granted` | `denied` (the permission of Android 13+ and the switch of the settings together). Needs no upload configuration. */
    Function("notificationPermission") {
      val ctx = context
      if (ctx != null && UploadNotifications(ctx).canPost()) "granted" else "denied"
    }

    /** Asks for the permission of Android 13+ (the system dialog; the explaining screen is the app's). Resolves `granted` | `denied`. */
    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      val ctx = context
      if (ctx == null) {
        promise.resolve("denied")
        return@AsyncFunction
      }
      val notifications = UploadNotifications(ctx)
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notifications.canPost()) {
        promise.resolve(if (notifications.canPost()) "granted" else "denied")
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve("denied")
        return@AsyncFunction
      }
      try {
        permissions.askForPermissions({ result ->
          val granted = result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED
          promise.resolve(if (granted) "granted" else "denied")
        }, Manifest.permission.POST_NOTIFICATIONS)
      } catch (error: Throwable) {
        promise.resolve("denied")
      }
    }

    /** Opens the notification settings of the app (for a permission the user refused for good). Resolves `true` when the screen was opened. */
    AsyncFunction("openNotificationSettings") {
      val ctx = context
      if (ctx == null) {
        false
      } else {
        try {
          val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
          } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.fromParts("package", ctx.packageName, null))
          }
          ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (error: Throwable) {
          false
        }
      }
    }

    /**
     * Where the notification sent the user: a value of the fixed set (`queue`) or `null`; read once (the extra is removed). The app takes
     * it through its own lock screen (policy P7); a value outside the set (an intent of another app) is ignored.
     */
    Function("launchTarget") {
      try {
        val fromNewIntent = newIntentTarget
        newIntentTarget = null
        val intent = appContext.currentActivity?.intent
        val target = intent?.getStringExtra(UploadNotifications.EXTRA_TARGET)
        intent?.removeExtra(UploadNotifications.EXTRA_TARGET)
        (fromNewIntent ?: target)?.takeIf { it in UploadNotifications.TARGETS }
      } catch (error: Throwable) {
        null
      }
    }

    // ---- e2e hook ----

    /**
     * E2E ONLY: writes a synthetic file of [sizeBytes] (deterministic content from [seed]) as the original of [assetId], without a camera,
     * and resolves its `{sizeBytes, sha256}`. In every other package (the e2e switch of the manifest is absent) it resolves `null` and writes nothing.
     */
    AsyncFunction("e2eInjectFile") { assetId: String, sizeBytes: Double, seed: Int ->
      withRuntime<Map<String, Any?>?>(null) { rt ->
        if (!rt.config.e2eCleartext || !SyntheticFile.write(rt.lifecycle.originalFile(assetId), sizeBytes.toLong(), seed)) {
          null
        } else {
          rt.lifecycle.digest(assetId)?.let { mapOf("sizeBytes" to it.sizeBytes.toDouble(), "sha256" to it.sha256Hex) }
        }
      }
    }
  }
}
