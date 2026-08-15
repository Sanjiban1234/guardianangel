import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';

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
  onRecenterPress?: () => void;
}

export function LiveMapView({
  currentLocation,
  riders,
  destination,
  onRecenterPress,
}: LiveMapViewProps) {
  const mapRef = useRef<MapView>(null);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);

  useEffect(() => {
    if (currentLocation && !initialRegion) {
      setInitialRegion({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  }, [currentLocation, initialRegion]);

  const fitToMarkers = () => {
    if (mapRef.current && riders.length > 0) {
      const coordinates = riders.map(r => ({
        latitude: r.latitude,
        longitude: r.longitude,
      }));

      if (destination) {
        coordinates.push({
          latitude: destination.latitude,
          longitude: destination.longitude,
        });
      }

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
        500
      );
    }
    onRecenterPress?.();
  };

  if (!initialRegion) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

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
        showsIndoors={true}
      >
        {/* Your current location marker */}
        {currentLocation && (
          <Marker
            coordinate={currentLocation}
            title="You"
            description="Your current position"
            pinColor="blue"
          />
        )}

        {/* Other riders */}
        {riders
          .filter(r => !r.isYou)
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
            title={destination.label}
            description="Ride destination"
            pinColor="red"
          />
        )}
      </MapView>

      {/* Recenter button */}
      <Pressable style={styles.recenterButton} onPress={recenter}>
        <Text style={styles.recenterText}>📍</Text>
      </Pressable>

      {/* Fit all markers button */}
      {riders.length > 0 && (
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B130E',
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
