import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';

interface RiderLocation {
  user_id: string;
  name: string;
  latitude: number;
  longitude: number;
  isYou?: boolean;
}

interface LiveMapViewProps {
  currentLocation: { latitude: number; longitude: number } | null;
  riders: RiderLocation[];
  destination?: { latitude: number; longitude: number; label: string } | null;
  routeCoordinates?: Array<{ latitude: number; longitude: number }>;
  onRecenterPress?: () => void;
  onMapPress?: (coordinate: { latitude: number; longitude: number }) => void;
}

// Default region: Kathmandu, Nepal (app's primary area of operation)
const DEFAULT_REGION: Region = {
  latitude: 27.7172,
  longitude: 85.3240,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export function LiveMapView({
  currentLocation,
  riders,
  destination,
  routeCoordinates,
  onRecenterPress,
  onMapPress,
}: LiveMapViewProps) {
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
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
          .map(rider => (
            <Marker
              key={rider.user_id}
              coordinate={{ latitude: rider.latitude, longitude: rider.longitude }}
              title={rider.name}
              description="Group member"
              pinColor="green"
            />
          ))}

        {/* Destination marker */}
        {destination && (
          <Marker
            coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
            title={destination.label || 'Destination'}
            description="Ride destination"
            pinColor="red"
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
});

export default LiveMapView;
