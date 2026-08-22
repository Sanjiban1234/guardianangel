package com.guardianangelmobile.tracking

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.guardianangelmobile.MainActivity
import com.guardianangelmobile.R

/**
 * Owns Android GPS for the complete active-ride lifetime. Readings are forwarded
 * to the existing JS telemetry pipeline; no second JS watchPosition is started.
 * The foreground service keeps this process eligible to run while the UI is
 * backgrounded, while Socket.IO remains responsible for reconnect and rejoin.
 */
class RideTrackingService : Service() {
  private lateinit var locationClient: FusedLocationProviderClient
  private var receivingUpdates = false

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      val location = result.lastLocation ?: return
      val reactContext = (application as ReactApplication).reactHost.currentReactContext ?: return
      if (!reactContext.hasActiveReactInstance()) return
      val payload = Arguments.createMap().apply {
        putDouble("timestamp", location.time.toDouble())
        putDouble("latitude", location.latitude)
        putDouble("longitude", location.longitude)
        putDouble("accuracy", location.accuracy.toDouble())
        putDouble("speed", if (location.hasSpeed()) location.speed.toDouble() else 0.0)
      }
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_LOCATION, payload)
      if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
        Log.d(TAG, "[BG LOCATION] delivered to telemetry")
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    locationClient = LocationServices.getFusedLocationProviderClient(this)
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopTracking()
      return START_NOT_STICKY
    }
    startInForeground()
    startTracking()
    return START_NOT_STICKY // an active ride is revalidated by JS before any restart
  }

  private fun startInForeground() {
    val launchIntent = Intent(this, MainActivity::class.java)
    val pendingIntent = PendingIntent.getActivity(
      this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Guardian Angel")
      .setContentText("Ride tracking active")
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun startTracking() {
    if (receivingUpdates) {
      Log.i(TAG, "[BG TRACKING RUNNING]")
      return
    }
    if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) !=
      PackageManager.PERMISSION_GRANTED) {
      Log.e(TAG, "[BG TRACKING STOP] location permission missing")
      stopSelf()
      return
    }
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
      .setMinUpdateIntervalMillis(2_000L)
      .setMinUpdateDistanceMeters(10f)
      .build()
    locationClient.requestLocationUpdates(request, callback, mainLooper)
    receivingUpdates = true
    isRunning = true
    Log.i(TAG, "[BG TRACKING START]")
  }

  private fun stopTracking() {
    if (receivingUpdates) locationClient.removeLocationUpdates(callback)
    receivingUpdates = false
    isRunning = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    Log.i(TAG, "[BG TRACKING STOP]")
  }

  override fun onDestroy() {
    if (receivingUpdates) locationClient.removeLocationUpdates(callback)
    receivingUpdates = false
    isRunning = false
    Log.i(TAG, "[BG TRACKING STOP]")
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID, "Active ride tracking", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shows when Guardian Angel is tracking an active ride"
        setShowBadge(false)
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  companion object {
    const val ACTION_START = "com.guardianangelmobile.tracking.START"
    const val ACTION_STOP = "com.guardianangelmobile.tracking.STOP"
    const val EVENT_LOCATION = "RideTrackingLocation"
    private const val CHANNEL_ID = "active_ride_tracking"
    private const val NOTIFICATION_ID = 4107
    private const val TAG = "RideTrackingService"
    @Volatile var isRunning = false
  }
}
