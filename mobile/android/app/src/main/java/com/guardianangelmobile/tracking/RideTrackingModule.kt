package com.guardianangelmobile.tracking

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RideTrackingModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  override fun getName() = "RideTracking"

  @ReactMethod
  fun start(promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) !=
      PackageManager.PERMISSION_GRANTED) {
      promise.reject("LOCATION_PERMISSION_REQUIRED", "Fine location permission is required")
      return
    }
    try {
      val intent = Intent(context, RideTrackingService::class.java)
        .setAction(RideTrackingService.ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(context, intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("TRACKING_START_FAILED", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      context.stopService(Intent(context, RideTrackingService::class.java))
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("TRACKING_STOP_FAILED", error)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) = promise.resolve(RideTrackingService.isRunning)

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit
}
