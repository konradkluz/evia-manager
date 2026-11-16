package pl.eviacharge.upload.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import pl.eviacharge.upload.schedule.UnmeteredCheck

/**
 * Is the active network free of charges for the transfer? From the capabilities of the network (`NET_CAPABILITY_NOT_METERED`) only: no SSID,
 * no `WifiManager`, no location, no new permission (`ACCESS_NETWORK_STATE` is declared for the constraints of the jobs). A Wi-Fi the user marked
 * as metered and the hotspot of a phone are "with charges" - the system says so. `null` = no active network or no answer.
 */
internal class AndroidUnmeteredCheck(
  context: Context,
) : UnmeteredCheck {
  private val manager: ConnectivityManager? = context.getSystemService(ConnectivityManager::class.java)

  override fun isUnmetered(): Boolean? =
    try {
      val network = manager?.activeNetwork
      val capabilities = if (network == null) null else manager?.getNetworkCapabilities(network)
      capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    } catch (error: RuntimeException) {
      null
    }
}
