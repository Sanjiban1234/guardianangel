import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Alert, Share } from 'react-native';
import LiveMapView from '../components/LiveMapView';
import RideAlertOverlay from '../components/RideAlertOverlay';
import { RideAlertState } from '../ride/RideAlertStore';

interface MapScreenProps {
  roomCode: string;
  destinationTitle: string;
  currentLocation: { latitude: number; longitude: number } | null;
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
 */
async function fetchRoute(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): Promise<Array<{ latitude: number; longitude: number }> | null> {
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

    return decodePolyline(overviewPolyline);
  } catch (error) {
    console.warn('[MapScreen] Route fetch error:', error);
    return null;
  }
}

export default function MapScreen({
  roomCode,
  destinationTitle,
  currentLocation,
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
}: MapScreenProps) {
  const [routeCoordinates, setRouteCoordinates] = useState<
    Array<{ latitude: number; longitude: number }> | undefined
  >(undefined);

  useEffect(() => {
    if (!currentLocation || !destination) {
      setRouteCoordinates(undefined);
      return;
    }

    let cancelled = false;

    fetchRoute(currentLocation, destination).then(route => {
      if (!cancelled && route) {
        setRouteCoordinates(route);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentLocation?.latitude?.toFixed(3),
    currentLocation?.longitude?.toFixed(3),
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

  // ──────────────────────────────────────────
  // ACTIVE RIDE — full-screen map with floating overlays
  // ──────────────────────────────────────────
  if (rideStarted) {
    return (
      <View style={styles.container}>
        <LiveMapView
          currentLocation={currentLocation}
          riders={riders}
          destination={destination}
          routeCoordinates={routeCoordinates}
          onRecenterPress={() => {}}
        />

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

        {riders.length > 0 && (
          <View style={styles.riderCountBadge}>
            <Text style={styles.riderCountText}>
              {riders.length} rider{riders.length !== 1 ? 's' : ''}
            </Text>
          </View>
        )}

        <RideAlertOverlay
          alerts={rideAlertState.alerts}
          criticalAlert={rideAlertState.criticalAlert}
          onDismiss={onDismissRideAlert}
        />

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
          <Pressable onPress={handleShareCode} style={styles.shareBtn}>
            <Text style={styles.shareBtnText}>Share</Text>
          </Pressable>
        </View>

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
});
