import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Alert, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import LiveMapView from '../components/LiveMapView';
import RideAlertOverlay from '../components/RideAlertOverlay';
import { RideAlertState } from '../ride/RideAlertStore';
import FriendInvitePicker from '../friends/FriendInvitePicker';
import { useWeatherSafety } from '../weather/useWeatherSafety';
import { WeatherSafetyCard } from '../weather/WeatherSafetyCard';
import { LiveStatsPanel } from './LiveStatsPanel';
import { DeadEndAdvisoryBanner } from './DeadEndAdvisoryBanner';
import type { MetricsSnapshot } from '../telemetry/RideMetricsAccumulator';
import type { RouteProgressSnapshot, RouteResult } from '../navigation/RouteProgressTracker';
import type { DeadEndState } from '../navigation/DeadEndDetector';
import { useRouteDeviation } from '../tracking/useRouteDeviation';
import { RecommendationCategory, RouteRecommendation } from '../recommendations/types';

interface MapScreenProps {
  roomCode: string;
  destinationTitle: string;
  currentLocation: { latitude: number; longitude: number; accuracy?: number } | null;
  isPaused?: boolean;
  riders: Array<{
    user_id: string;
    name: string;
    latitude: number;
    longitude: number;
    isYou?: boolean;
    vehicleModel?: string;
    plateNumber?: string;
    lastUpdatedAt?: number;
    connectionState?: 'CONNECTED' | 'DISCONNECTED';
    locationFreshness?: 'FRESH' | 'STALE';
    rideState?: 'active' | 'paused';
  }>;
  destination?: { latitude: number; longitude: number; label: string } | null;
  onOpenControls: () => void;
  onEndRide: () => void;

  // Pre-ride state props
  isHost: boolean;
  rideStarted: boolean;
  members: Array<{
    user_id: string;
    name: string;
    role?: string;
    isYou?: boolean;
    vehicleModel?: string;
    plateNumber?: string;
    connectionState?: 'CONNECTED' | 'DISCONNECTED';
    locationFreshness?: 'FRESH' | 'STALE';
  }>;
  onStartRide?: () => void;
  isStartingRide?: boolean;
  onLeaveRoom: () => void;
  rideAlertState: RideAlertState;
  onDismissRideAlert: (alertId: string) => void;
  roomId?: string;
  apiBaseUrl?: string;
  authToken: string;
  onWeatherAdvisory?: (alert: { id: string; type?: string; severity: 'info' | 'warning'; title: string; message: string }, snapshotKey: string) => void;
  /** Live ride statistics from RideMetricsAccumulator (null = not in active ride). */
  liveMetrics?: MetricsSnapshot | null;
  /** Route progress / ETA from RouteProgressTracker (null = no route available). */
  routeProgress?: RouteProgressSnapshot | null;
  /** Dead-end advisory state (null treated as 'clear'). */
  deadEndState?: DeadEndState | null;
  /** Called when user dismisses the dead-end advisory banner. */
  onDismissDeadEnd?: () => void;
  /** The App-owned, single active route used by every route-dependent feature. */
  activeRoute?: RouteResult | null;
  /** Accepts only complete provider routes and atomically replaces the active route. */
  onActiveRouteChanged?: (route: RouteResult) => void;
}

const COLORS = {
  ink: '#0B130E',
  card: '#142318',
  line: '#1E3A28',
  text: '#F0FDF4',
  blue: '#2F80ED',
  red: '#DC2626',
  green: '#16A34A',
  muted: '#A3B8A8',
};

/**
 * Decode a Google Maps encoded polyline string into coordinate array.
 */
function decodePolyline(encoded: string): Array<{ latitude: number; longitude: number }> {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
}

/**
 * Fetch route from Google Directions API.
 * Falls back gracefully if API key is not configured or request fails.
 *
 * Returns one complete provider route so all consumers use the same geometry,
 * distance, and duration.
 */
async function fetchRoute(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): Promise<RouteResult | null> {
  try {
    const apiKey = typeof process !== 'undefined' && process.env
      ? process.env.GOOGLE_MAPS_API_KEY
      : undefined;

    if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      console.warn('[MapScreen] Google Maps API key not configured for Directions API');
      return null;
    }

    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&mode=driving` +
      `&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes?.length) {
      console.warn('[MapScreen] Directions API returned:', data.status, '| If REQUEST_DENIED, enable "Directions API" in Google Cloud Console → APIs & Services.');
      return null;
    }

    const overviewPolyline = data.routes[0].overview_polyline?.points;
    if (!overviewPolyline) return null;

    const leg = data.routes[0].legs?.[0];
    const polyline = decodePolyline(overviewPolyline);
    if (polyline.length < 2 || !Number.isFinite(leg?.distance?.value) || !Number.isFinite(leg?.duration?.value)) return null;
    return { polyline, totalDistanceMeters: leg.distance.value, totalDurationSeconds: leg.duration.value, fetchedAt: Date.now() };
  } catch {
    console.warn('[MapScreen] Route fetch failed');
    return null;
  }
}

export default function MapScreen({
  roomCode,
  destinationTitle,
  currentLocation,
  isPaused = false,
  riders,
  destination,
  onOpenControls,
  onEndRide,
  isHost,
  rideStarted,
  members,
  onStartRide,
  isStartingRide = false,
  onLeaveRoom,
  rideAlertState,
  onDismissRideAlert,
  roomId,
  apiBaseUrl,
  authToken,
  onWeatherAdvisory,
  liveMetrics = null,
  routeProgress = null,
  deadEndState = null,
  onDismissDeadEnd,
  activeRoute = null,
  onActiveRouteChanged,
}: MapScreenProps) {
  const [copyConfirmationVisible, setCopyConfirmationVisible] = useState(false);
  const [weatherExpanded, setWeatherExpanded] = useState(false);
  const [recommendationCategory, setRecommendationCategory] = useState<RecommendationCategory | null>(null);
  const [recommendations, setRecommendations] = useState<RouteRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const recommendationRequestRef = useRef(0);
  const routeCoordinates = activeRoute?.polyline;
  const weather = useWeatherSafety(roomCode, authToken, currentLocation, destination || null, routeCoordinates || [], true, onWeatherAdvisory, activeRoute?.fetchedAt);

  const { isRerouting, rerouteError, evaluateAndReroute, clearRerouteError } = useRouteDeviation();

  useEffect(() => { setRecommendations([]); recommendationRequestRef.current += 1; }, [activeRoute?.fetchedAt]);
  useEffect(() => { if (!recommendationCategory || !activeRoute || !apiBaseUrl) return; const request=++recommendationRequestRef.current,controller=new AbortController(); setRecommendationsLoading(true); fetch(`${apiBaseUrl}/api/routes/recommendations`,{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${authToken}`,'Content-Type':'application/json'},body:JSON.stringify({category:recommendationCategory,route:activeRoute.polyline})}).then(r=>r.ok?r.json():Promise.reject()).then(body=>{if(request===recommendationRequestRef.current)setRecommendations(Array.isArray(body.recommendations)?body.recommendations.slice(0,6):[]);}).catch(()=>{if(request===recommendationRequestRef.current)setRecommendations([]);}).finally(()=>{if(request===recommendationRequestRef.current)setRecommendationsLoading(false);}); return()=>controller.abort();},[recommendationCategory,activeRoute?.fetchedAt,apiBaseUrl,authToken]);

  useEffect(() => {
    if (!currentLocation || !destination) {
      return;
    }

    let cancelled = false;

    fetchRoute(currentLocation, destination).then(route => {
      if (!cancelled && route) onActiveRouteChanged?.(route);
    });

    return () => {
      cancelled = true;
    };
  }, [
    destination?.latitude,
    destination?.longitude,
  ]);

  // Evaluate route deviation on location updates
  useEffect(() => {
    if (!currentLocation || !destination || !routeCoordinates || routeCoordinates.length < 2) {
      return;
    }

    let cancelled = false;
    evaluateAndReroute(currentLocation, destination, routeCoordinates, fetchRoute).then(newRoute => {
      if (!cancelled && newRoute && newRoute.polyline && newRoute.polyline.length >= 2) onActiveRouteChanged?.(newRoute);
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentLocation?.latitude,
    currentLocation?.longitude,
    destination?.latitude,
    destination?.longitude,
  ]);

  const handleShareCode = async () => {
    try {
      await Share.share({
        title: `Join my ride to ${destinationTitle}`,
        message:
          `Join my ride group on Guardian Angel!\n` +
          `Destination: ${destinationTitle}\n` +
          `Group Code: ${roomCode}`,
      });
    } catch {
      Alert.alert('Share Error', 'Could not open share sheet.');
    }
  };

  const handleCopyCode = () => {
    Clipboard.setString(roomCode);
    setCopyConfirmationVisible(true);
    setTimeout(() => setCopyConfirmationVisible(false), 2_000);
  };

  // ──────────────────────────────────────────
  // ACTIVE RIDE — full-screen map with floating overlays
  // ──────────────────────────────────────────
  if (rideStarted) {
    const showDeadEnd =
      deadEndState?.state === 'suspected' || deadEndState?.state === 'confirmed';

    return (
      <View style={styles.container}>
        <LiveMapView
          currentLocation={currentLocation}
          riders={riders}
          destination={destination}
          routeCoordinates={routeCoordinates}
          recommendations={recommendations}
          onRecenterPress={() => {}}
        />

        {/* ── Floating header bar ─────────────────────────────────── */}
        <View style={styles.floatingHeader}>
          <View style={styles.headerLeft}>
            <Text style={styles.roomCodeText}>CODE: {roomCode}</Text>
            <Text style={styles.destinationText} numberOfLines={1}>
              {destinationTitle || 'No destination set'}
            </Text>
          </View>
          <Pressable onPress={isHost ? onEndRide : onLeaveRoom} style={styles.endButton}>
            <Text style={styles.endButtonText}>{isHost ? '✕ End Ride' : '← Leave Group'}</Text>
          </Pressable>
        </View>

        {isPaused && (
          <View style={styles.pausedBadgeOverlay}>
            <Text style={styles.pausedBadgeText}>⏸️ PAUSED</Text>
          </View>
        )}

        {isRerouting && (
          <View style={styles.reroutingBadgeOverlay}>
            <Text style={styles.reroutingBadgeText}>↻ Rerouting...</Text>
          </View>
        )}

        {rerouteError && (
          <View style={styles.rerouteErrorBanner}>
            <Text style={styles.rerouteErrorText}>{rerouteError}</Text>
            <Pressable onPress={clearRerouteError} style={styles.dismissErrorBtn}>
              <Text style={styles.dismissErrorText}>✕</Text>
            </Pressable>
          </View>
        )}

        {riders.length > 0 && (
          <View style={styles.riderCountBadge}>
            <Text style={styles.riderCountText}>
              {riders.length} rider{riders.length !== 1 ? 's' : ''}
            </Text>
          </View>
        )}

        {/* ── Live Stats Panel (floating, above controls) ─────────── */}
        <View style={styles.liveStatsContainer}>
          {showDeadEnd && deadEndState && (
            <DeadEndAdvisoryBanner
              state={deadEndState}
              onDismiss={onDismissDeadEnd ?? (() => {})}
              testID="dead-end-banner"
            />
          )}
          <LiveStatsPanel
            metrics={liveMetrics}
            routeProgress={routeProgress}
            testID="live-stats-panel"
          />
        </View>

        <RideAlertOverlay
          alerts={rideAlertState.alerts}
          criticalAlert={rideAlertState.criticalAlert}
          onDismiss={onDismissRideAlert}
        />
        <WeatherSafetyCard data={weather} expanded={weatherExpanded} onPress={() => setWeatherExpanded(value => !value)} />
        <View style={styles.recommendationControls}>{(['fuel','food','workshop'] as RecommendationCategory[]).map(category=><Pressable key={category} onPress={()=>setRecommendationCategory(value=>value===category?null:category)} style={styles.recommendationChip}><Text style={styles.recommendationText}>{recommendationsLoading&&recommendationCategory===category?'…':category}</Text></Pressable>)}</View>
        <Pressable onPress={onOpenControls} style={styles.controlsButton}>
          <Text style={styles.controlsButtonIcon}>⚙️</Text>
          <Text style={styles.controlsButtonText}>Ride Controls</Text>
        </Pressable>
      </View>
    );
  }

  // ──────────────────────────────────────────
  // PRE-RIDE — map + member panel + action
  // ──────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Map */}
      <View style={styles.preRideMapArea}>
        <LiveMapView
          currentLocation={currentLocation}
          riders={riders}
          destination={destination}
          routeCoordinates={routeCoordinates}
          onRecenterPress={() => {}}
        />
      </View>

      {/* Bottom panel */}
      <View style={styles.preRidePanel}>
        {/* Header row */}
        <View style={styles.panelHeader}>
          <Pressable onPress={onLeaveRoom} style={styles.leaveBtn}>
            <Text style={styles.leaveBtnText}>← Leave</Text>
          </Pressable>
          <View style={styles.panelHeaderCenter}>
            <Text style={styles.panelEyebrow}>CODE: {roomCode}</Text>
            <Text style={styles.panelTitle} numberOfLines={1}>
              {destinationTitle || 'Group Ride'}
            </Text>
          </View>
          <View style={styles.codeActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy room code"
              onPress={handleCopyCode}
              style={styles.copyBtn}
            >
              <Text style={styles.copyBtnText}>{copyConfirmationVisible ? 'Copied' : 'Copy'}</Text>
            </Pressable>
            <Pressable onPress={handleShareCode} style={styles.shareBtn}>
              <Text style={styles.shareBtnText}>Share</Text>
            </Pressable>
          </View>
        </View>

        {copyConfirmationVisible && <Text style={styles.copyConfirmation}>Room code copied</Text>}
        <WeatherSafetyCard data={weather} expanded={weatherExpanded} onPress={() => setWeatherExpanded(value => !value)} />

        {/* Member list */}
        <View style={styles.memberSection}>
          <Text style={styles.memberSectionTitle}>
            Riders ({members.length})
          </Text>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No riders have joined yet.</Text>
          ) : (
            <View style={styles.memberList}>
              {members.map((member) => (
                <View key={member.user_id} style={styles.memberRow}>
                  <View
                    style={[
                      styles.memberDot,
                      member.connectionState === 'DISCONNECTED'
                        ? styles.disconnectedDot
                        : member.locationFreshness === 'STALE'
                          ? styles.staleDot
                          : member.connectionState === 'CONNECTED'
                            ? styles.connectedDot
                            : styles.unknownDot,
                    ]}
                  />
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.name}
                    {member.isYou ? ' (You)' : ''}
                  </Text>
                  {member.role === 'owner' && (
                    <Text style={styles.hostBadge}>HOST</Text>
                  )}
                  {!member.isYou && member.connectionState === 'DISCONNECTED' && (
                    <Text style={styles.memberPresence}>OFFLINE</Text>
                  )}
                  {!member.isYou && member.connectionState !== 'DISCONNECTED' && member.locationFreshness === 'STALE' && (
                    <Text style={styles.memberPresence}>STALE</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Action area */}
        {isHost && roomId && apiBaseUrl && authToken && <FriendInvitePicker roomId={roomId} apiBaseUrl={apiBaseUrl} authToken={authToken} />}
        {isHost ? (
          <Pressable
            onPress={() => {
              onStartRide?.();
            }}
            disabled={isStartingRide}
            style={[styles.startBtn, isStartingRide && styles.startBtnDisabled]}
          >
            <Text style={styles.startBtnText}>{isStartingRide ? 'Starting Ride...' : 'Start Ride →'}</Text>
          </Pressable>
        ) : (
          <View style={styles.waitingBanner}>
            <Text style={styles.waitingText}>
              Waiting for host to start the ride...
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },

  // ── Active ride floating overlays ──
  floatingHeader: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 19, 14, 0.95)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  headerLeft: {
    flex: 1,
  },
  roomCodeText: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  destinationText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  endButton: {
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderColor: COLORS.red,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  endButtonText: {
    color: COLORS.red,
    fontSize: 12,
    fontWeight: '800',
  },
  copyBtn: {
    backgroundColor: COLORS.green,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  copyBtnText: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  liveStatsContainer: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    gap: 8,
  },
  riderCountBadge: {
    position: 'absolute',
    top: 110,
    left: 16,
    backgroundColor: 'rgba(11, 19, 14, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  riderCountText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  controlsButton: {
    position: 'absolute',
    bottom: 30,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(20, 35, 24, 0.95)',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  controlsButtonIcon: {
    fontSize: 20,
  },
  controlsButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },

  // ── Pre-ride layout ──
  preRideMapArea: {
    flex: 1,
  },
  preRidePanel: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 12,
  },

  // Panel header
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leaveBtn: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  leaveBtnText: {
    color: COLORS.blue,
    fontSize: 13,
    fontWeight: '700',
  },
  panelHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  codeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  copyConfirmation: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  panelEyebrow: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  panelTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 1,
  },
  shareBtn: {
    backgroundColor: COLORS.blue,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  // Member list
  memberSection: {
    gap: 8,
  },
  memberSectionTitle: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  memberList: {
    gap: 6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectedDot: {
    backgroundColor: COLORS.green,
  },
  staleDot: {
    backgroundColor: '#F59E0B',
  },
  disconnectedDot: {
    backgroundColor: '#6B7280',
  },
  unknownDot: {
    backgroundColor: COLORS.muted,
  },
  memberName: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  hostBadge: {
    color: COLORS.green,
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: '#0F2918',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },

  // Start / Waiting
  startBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  memberPresence: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 6,
  },
  startBtnDisabled: { opacity: 0.6 },
  startBtnText: {
    color: COLORS.ink,
    fontWeight: '900',
    fontSize: 15,
  },
  waitingBanner: {
    backgroundColor: '#0F1A12',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  waitingText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  pausedBadgeOverlay: {
    position: 'absolute',
    top: 90,
    alignSelf: 'center',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 10,
  },
  pausedBadgeText: {
    color: '#0B130E',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  recommendationControls: { position: 'absolute', right: 12, bottom: 96, flexDirection: 'row', gap: 6 },
  recommendationChip: { backgroundColor: 'rgba(11,19,14,0.9)', borderColor: COLORS.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 6 },
  recommendationText: { color: COLORS.text, fontSize: 10, fontWeight: '800' },
  reroutingBadgeOverlay: {
    position: 'absolute',
    top: 130,
    alignSelf: 'center',
    backgroundColor: '#2F80ED',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 10,
  },
  reroutingBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  rerouteErrorBanner: {
    position: 'absolute',
    top: 170,
    left: 20,
    right: 20,
    backgroundColor: '#142318',
    borderColor: '#DC2626',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  rerouteErrorText: {
    color: '#F0FDF4',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  dismissErrorBtn: {
    marginLeft: 10,
    padding: 4,
  },
  dismissErrorText: {
    color: '#A3B8A8',
    fontSize: 14,
    fontWeight: '800',
  },
});
