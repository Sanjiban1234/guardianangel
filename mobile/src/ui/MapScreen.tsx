import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Alert } from 'react-native';
import LiveMapView from '../components/LiveMapView';

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
  }>;
  destination?: { latitude: number; longitude: number; label: string } | null;
  onOpenControls: () => void;
  onEndRide: () => void;
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
    // Read API key from the Babel-injected env variable
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
      console.warn('[MapScreen] Directions API returned:', data.status);
      return null;
    }

    // Decode the overview polyline
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
}: MapScreenProps) {
  const [routeCoordinates, setRouteCoordinates] = useState<
    Array<{ latitude: number; longitude: number }> | undefined
  >(undefined);

  // Fetch route when current location and destination are both available
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
    // Only refetch when either endpoint changes significantly
    currentLocation?.latitude?.toFixed(3),
    currentLocation?.longitude?.toFixed(3),
    destination?.latitude,
    destination?.longitude,
  ]);

  return (
    <View style={styles.container}>
      {/* Full screen map */}
      <LiveMapView
        currentLocation={currentLocation}
        riders={riders}
        destination={destination}
        routeCoordinates={routeCoordinates}
        onRecenterPress={() => {}}
      />

      {/* Floating header */}
      <View style={styles.floatingHeader}>
        <View style={styles.headerLeft}>
          <Text style={styles.roomCodeText}>CODE: {roomCode}</Text>
          <Text style={styles.destinationText} numberOfLines={1}>
            {destinationTitle || 'No destination set'}
          </Text>
        </View>
        <Pressable onPress={onEndRide} style={styles.endButton}>
          <Text style={styles.endButtonText}>✕ End</Text>
        </Pressable>
      </View>

      {/* Rider count badge */}
      {riders.length > 0 && (
        <View style={styles.riderCountBadge}>
          <Text style={styles.riderCountText}>
            👥 {riders.length} rider{riders.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Floating bottom controls button */}
      <Pressable onPress={onOpenControls} style={styles.controlsButton}>
        <Text style={styles.controlsButtonIcon}>⚙️</Text>
        <Text style={styles.controlsButtonText}>Ride Controls</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
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
});
