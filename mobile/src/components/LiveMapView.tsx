import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import PeerRiderMarker, { PeerRider } from './PeerRiderMarker';
import RecommendationMarker from '../recommendations/RecommendationMarker';
import { RouteRecommendation } from '../recommendations/types';

interface RiderLocation extends PeerRider {
  isYou?: boolean;
}

interface LiveMapViewProps {
  currentLocation: { latitude: number; longitude: number } | null;
  riders: RiderLocation[];
  destination?: { latitude: number; longitude: number; label: string } | null;
  routeCoordinates?: Array<{ latitude: number; longitude: number }>;
  onRecenterPress?: () => void;
  onMapPress?: (coordinate: { latitude: number; longitude: number }) => void;
  /** Temporary field-test aid: confirms state changes before marker rendering. */
  showDiagnostics?: boolean;
  recommendations?: RouteRecommendation[];
}

// Default region: Kathmandu, Nepal (app's primary area of operation)
const DEFAULT_REGION: Region = {
  latitude: 27.7172,
  longitude: 85.3240,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

/** Places retain the conventional pin vocabulary; peer riders use PeerRiderMarker. */
export const DESTINATION_PIN_COLOR = '#DC2626';

export function LiveMapView({
  currentLocation,
  riders,
  destination,
  routeCoordinates,
  onRecenterPress,
  onMapPress,
  showDiagnostics = __DEV__,
  recommendations = [],
}: LiveMapViewProps) {
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const hasSetInitialRegion = useRef(false);

  // Compute initial region: use current location if available, otherwise default
  const initialRegion: Region = currentLocation
    ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }
    : DEFAULT_REGION;

  // Animate to user location when it first becomes available
  useEffect(() => {
    if (currentLocation && mapRef.current && mapReady && !hasSetInitialRegion.current) {
      hasSetInitialRegion.current = true;
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        800,
      );
    }
  }, [currentLocation, mapReady]);

  const fitToMarkers = () => {
    if (!mapRef.current) return;

    const coordinates: Array<{ latitude: number; longitude: number }> = [];

    if (currentLocation) {
      coordinates.push(currentLocation);
    }

    riders.forEach(r => {
      if (r.latitude !== 0 || r.longitude !== 0) {
        coordinates.push({ latitude: r.latitude, longitude: r.longitude });
      }
    });

    if (destination) {
      coordinates.push({ latitude: destination.latitude, longitude: destination.longitude });
    }

    if (coordinates.length > 0) {
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
        animated: true,
      });
    }
  };

  const recenter = () => {
    if (mapRef.current && currentLocation) {
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500,
      );
    }
    onRecenterPress?.();
  };

  const handleMapPress = (event: any) => {
    if (onMapPress && event.nativeEvent?.coordinate) {
      onMapPress(event.nativeEvent.coordinate);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        showsTraffic={false}
        showsBuildings={true}
        showsIndoors={false}
        mapType="standard"
        onMapReady={() => setMapReady(true)}
        onPress={handleMapPress}
      >
        {/* Other riders (not "you") */}
        {riders
          .filter(r => !r.isYou && (r.latitude !== 0 || r.longitude !== 0))
          .map(rider => {
            console.log('[PEER MARKER RENDERED]');
            return (
              <PeerRiderMarker
                key={rider.user_id}
                rider={rider}
                selected={selectedRiderId === rider.user_id}
                onPress={() => setSelectedRiderId(rider.user_id)}
              />
            );
          })}

        {/* Destination marker */}
        {destination && (
          <Marker
            coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
            title={destination.label || 'Destination'}
            description="Ride destination"
            pinColor={DESTINATION_PIN_COLOR}
          />
        )}

        {/* Route polyline */}
        {routeCoordinates && routeCoordinates.length > 1 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeWidth={4}
            strokeColor="#2F80ED"
            lineDashPattern={[0]}
          />
        )}
        {recommendations.map(item => <RecommendationMarker key={item.placeId} item={item} />)}
      </MapView>

      {/* Map loading indicator */}
      {!mapReady && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}

      {/* Recenter button */}
      <Pressable style={styles.recenterButton} onPress={recenter}>
        <Text style={styles.recenterText}>📍</Text>
      </Pressable>

      {/* Fit all markers button */}
      {(riders.length > 0 || destination) && (
        <Pressable style={styles.fitButton} onPress={fitToMarkers}>
          <Text style={styles.fitText}>🎯</Text>
        </Pressable>
      )}

      {showDiagnostics && (
        <View style={styles.diagnosticPanel} pointerEvents="none">
          <Text style={styles.diagnosticTitle}>LIVE RIDER STATE</Text>
          {riders.length === 0 ? (
            <Text style={styles.diagnosticRow}>No room members received.</Text>
          ) : riders.map((rider) => (
            <Text key={rider.user_id} style={styles.diagnosticRow} numberOfLines={1}>
              {rider.isYou ? 'YOU' : rider.name} · {rider.user_id} · {rider.latitude.toFixed(6)}, {rider.longitude.toFixed(6)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 19, 14, 0.8)',
  },
  loadingText: {
    color: '#F0FDF4',
    fontSize: 16,
  },
  recenterButton: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2F80ED',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  recenterText: {
    fontSize: 24,
  },
  fitButton: {
    position: 'absolute',
    bottom: 170,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#16A34A',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fitText: {
    fontSize: 24,
  },
  diagnosticPanel: {
    position: 'absolute',
    left: 12,
    right: 84,
    bottom: 16,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(11, 19, 14, 0.86)',
  },
  diagnosticTitle: { color: '#86EFAC', fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  diagnosticRow: { color: '#F0FDF4', fontSize: 10, marginTop: 3, fontFamily: 'monospace' },
});

export default LiveMapView;
