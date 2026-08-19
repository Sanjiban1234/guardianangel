import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Callout, Marker } from 'react-native-maps';

export interface PeerRider {
  user_id: string;
  name: string;
  latitude: number;
  longitude: number;
  vehicleModel?: string;
  plateNumber?: string;
  lastUpdatedAt?: number;
  connectionState?: 'CONNECTED' | 'DISCONNECTED';
  locationFreshness?: 'FRESH' | 'STALE';
}

export type PeerRiderVisualState = 'LIVE' | 'STALE' | 'DISCONNECTED';

export function peerRiderVisualState(rider: PeerRider): PeerRiderVisualState {
  if (rider.connectionState === 'DISCONNECTED') return 'DISCONNECTED';
  if (rider.locationFreshness === 'STALE') return 'STALE';
  return 'LIVE';
}

export function compactRiderName(name: string): string {
  const firstName = name.trim().split(/\s+/)[0] || 'Rider';
  return firstName.length > 12 ? `${firstName.slice(0, 11)}…` : firstName;
}

export function riderStatusText(rider: PeerRider): string {
  if (rider.connectionState === 'DISCONNECTED') return 'Disconnected · last known location';
  if (rider.locationFreshness === 'STALE') return 'Stale location';
  return 'Connected';
}

export function riderLastUpdateText(lastUpdatedAt?: number): string {
  if (lastUpdatedAt == null || !Number.isFinite(lastUpdatedAt)) return 'Last update unavailable';
  return `Updated ${Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000))} sec ago`;
}

interface PeerRiderMarkerProps {
  rider: PeerRider;
  selected: boolean;
  onPress: () => void;
}

/** A compact custom marker: rider/vehicle symbols deliberately never use map pins. */
export default function PeerRiderMarker({ rider, selected, onPress }: PeerRiderMarkerProps) {
  const state = peerRiderVisualState(rider);
  const stateStyle = state === 'LIVE' ? styles.live : state === 'STALE' ? styles.stale : styles.disconnected;

  return (
    <Marker
      coordinate={{ latitude: rider.latitude, longitude: rider.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      zIndex={selected ? 10 : state === 'LIVE' ? 3 : state === 'STALE' ? 2 : 1}
      onPress={onPress}
    >
      <View style={[styles.marker, state === 'DISCONNECTED' && styles.dimmed]}>
        <View style={styles.nameLabel}>
          <Text style={styles.nameText} numberOfLines={1}>{compactRiderName(rider.name)}</Text>
        </View>
        <View style={[styles.statusRing, stateStyle]}>
          <View style={styles.innerCircle}>
            <View style={styles.motorcycle}>
              <View style={styles.bikeFrame} />
              <View style={[styles.wheel, styles.frontWheel]} />
              <View style={[styles.wheel, styles.backWheel]} />
            </View>
          </View>
        </View>
      </View>
      <Callout tooltip>
        <View style={styles.callout}>
          <Text style={styles.calloutName}>{rider.name}</Text>
          {!!rider.vehicleModel && <Text style={styles.calloutIdentity}>{rider.vehicleModel}</Text>}
          {!!rider.plateNumber && <Text style={styles.calloutIdentity}>{rider.plateNumber}</Text>}
          <Text style={styles.calloutStatus}>{riderStatusText(rider)}</Text>
          <Text style={styles.calloutAge}>{riderLastUpdateText(rider.lastUpdatedAt)}</Text>
        </View>
      </Callout>
    </Marker>
  );
}

const styles = StyleSheet.create({
  marker: { alignItems: 'center', width: 70 },
  dimmed: { opacity: 0.68 },
  nameLabel: { backgroundColor: 'rgba(11, 19, 14, 0.94)', borderColor: '#31513A', borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, maxWidth: 70, marginBottom: 3 },
  nameText: { color: '#F0FDF4', fontSize: 10, fontWeight: '800' },
  statusRing: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B130E', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 4 },
  live: { borderColor: '#22C55E' },
  stale: { borderColor: '#F59E0B' },
  disconnected: { borderColor: '#9CA3AF' },
  innerCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#142318', alignItems: 'center', justifyContent: 'center' },
  motorcycle: { width: 19, height: 12, position: 'relative' },
  bikeFrame: { position: 'absolute', left: 4, top: 4, width: 11, height: 5, borderTopWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderColor: '#F0FDF4', transform: [{ skewX: '-25deg' }] },
  wheel: { position: 'absolute', bottom: 0, width: 5, height: 5, borderRadius: 3, borderWidth: 1.5, borderColor: '#F0FDF4' },
  frontWheel: { right: 1 },
  backWheel: { left: 1 },
  callout: { width: 205, borderRadius: 12, borderWidth: 1, borderColor: '#31513A', backgroundColor: '#142318', padding: 12 },
  calloutName: { color: '#F0FDF4', fontSize: 16, fontWeight: '900' },
  calloutIdentity: { color: '#D1E1D5', fontSize: 13, marginTop: 3 },
  calloutStatus: { color: '#86EFAC', fontSize: 12, fontWeight: '800', marginTop: 9 },
  calloutAge: { color: '#A3B8A8', fontSize: 12, marginTop: 3 },
});
