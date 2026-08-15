import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
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
};

export default function MapScreen({
  roomCode,
  destinationTitle,
  currentLocation,
  riders,
  destination,
  onOpenControls,
  onEndRide,
}: MapScreenProps) {
  return (
    <View style={styles.container}>
      {/* Full screen map */}
      <LiveMapView
        currentLocation={currentLocation}
        riders={riders}
        destination={destination}
        onRecenterPress={() => {}}
      />

      {/* Floating header */}
      <View style={styles.floatingHeader}>
        <View style={styles.headerLeft}>
          <Text style={styles.roomCodeText}>CODE: {roomCode}</Text>
          <Text style={styles.destinationText}>{destinationTitle}</Text>
        </View>
        <Pressable onPress={onEndRide} style={styles.endButton}>
          <Text style={styles.endButtonText}>✕ End</Text>
        </Pressable>
      </View>

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
