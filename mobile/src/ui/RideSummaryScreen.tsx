import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRideSummary } from './useRideSummary';

interface RideSummaryScreenProps {
  groupCode: string;
  authToken: string;
  apiBaseUrl: string;
  onReturnToPortal?: () => void;
}

const formatDistance = (meters: number) => (
  meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
);

const formatDuration = (milliseconds: number) => {
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

export const RideSummaryScreen: React.FC<RideSummaryScreenProps> = ({ groupCode, authToken, apiBaseUrl, onReturnToPortal }) => {
  const { data, loading, error, retry } = useRideSummary(groupCode, authToken, apiBaseUrl);

  if (loading) {
    return <SafeAreaView style={styles.container}><View style={styles.centered}><Text style={styles.muted}>Loading ride summary...</Text></View></SafeAreaView>;
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>Ride summary unavailable.</Text>
          <Text style={styles.muted}>{error || 'No ride summary was returned.'}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={retry}><Text style={styles.secondaryButtonText}>Retry</Text></TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={onReturnToPortal}><Text style={styles.primaryButtonText}>Return Home</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>RIDE ENDED</Text>
        <Text style={styles.title}>Ride Summary</Text>
        <Text style={styles.muted}>Room #{data.group_code}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>YOUR RECORDED DISTANCE</Text>
          <Text style={styles.value}>{formatDistance(data.total_distance_meters)}</Text>
          <Text style={styles.detail}>Recorded from your GPS telemetry</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>YOUR RIDE DURATION</Text>
          <Text style={styles.value}>{formatDuration(data.actual_duration_ms)}</Text>
          <Text style={styles.detail}>Calculated from your recorded telemetry</Text>
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={onReturnToPortal}><Text style={styles.primaryButtonText}>Done</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B130E' },
  content: { padding: 20, paddingTop: 36, gap: 14 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  eyebrow: { color: '#16A34A', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#F0FDF4', fontSize: 28, fontWeight: '800' },
  muted: { color: '#A3B8A8', fontSize: 14, textAlign: 'center' },
  card: { backgroundColor: '#142318', borderColor: '#1E3A28', borderWidth: 1, borderRadius: 14, padding: 18 },
  label: { color: '#A3B8A8', fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  value: { color: '#F0FDF4', fontSize: 34, fontWeight: '800', marginTop: 8 },
  detail: { color: '#A3B8A8', fontSize: 12, marginTop: 5 },
  primaryButton: { backgroundColor: '#16A34A', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  primaryButtonText: { color: '#0B130E', fontSize: 15, fontWeight: '800' },
  secondaryButton: { borderColor: '#16A34A', borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 6 },
  secondaryButtonText: { color: '#F0FDF4', fontSize: 15, fontWeight: '700' },
});

export default RideSummaryScreen;
