import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRideSummary } from './useRideSummary';

interface RideSummaryScreenProps {
  groupCode: string;
  authToken: string;
  apiBaseUrl: string;
  onReturnToPortal?: () => void;
}

export const formatDistance = (meters: number): string => {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};

export const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
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
          <Text style={styles.failureTitle}>Ride summary unavailable.</Text>
          <Text style={styles.muted}>{error || 'No ride summary was returned.'}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={retry}><Text style={styles.secondaryButtonText}>Retry</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={onReturnToPortal}><Text style={styles.primaryButtonText}>Return Home</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.completionBadge}>● RIDE COMPLETED</Text>
            <Text style={styles.roomCode} numberOfLines={1}>ROOM #{data.group_code}</Text>
          </View>
          <Text style={styles.heroTitle}>Post-Ride Summary</Text>
          <Text style={styles.heroSubtitle}>Recorded GPS Telemetry</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>TOTAL DISTANCE COVERED</Text>
          <Text style={styles.distanceValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{formatDistance(data.total_distance_meters)}</Text>
          <Text style={styles.detail}>Recorded via GPS telemetry</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>RIDE DURATION</Text>
          <View style={styles.durationRow}>
            <View style={styles.durationColumn}>
              <Text style={styles.columnLabel}>Actual Time</Text>
              <Text style={styles.durationValue}>{formatDuration(data.actual_duration_ms)}</Text>
            </View>
            <View style={styles.durationColumn}>
              <Text style={styles.columnLabel}>Pace Benchmark</Text>
              <Text style={styles.unavailableValue}>Unavailable</Text>
            </View>
          </View>
          <Text style={styles.notice}>Pace comparison is not available for this ride.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Route Speed Profile</Text>
          <Text style={styles.detail}>Downsampled telemetry trace</Text>
          <View style={styles.emptyProfile}>
            <Text style={styles.warningSymbol}>⚠</Text>
            <Text style={styles.emptyProfileTitle}>Speed Chart Unavailable</Text>
            <Text style={styles.emptyProfileText}>Not enough recorded telemetry to generate a meaningful speed profile.</Text>
          </View>
        </View>

        <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={onReturnToPortal}><Text style={styles.primaryButtonText}>DONE</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08100B' },
  content: { padding: 20, paddingTop: 28, paddingBottom: 32, gap: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  muted: { color: '#A3B8A8', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  failureTitle: { color: '#F0FDF4', fontSize: 24, fontWeight: '800' },
  heroCard: { backgroundColor: '#12351E', borderColor: '#27864B', borderWidth: 1, borderRadius: 20, padding: 20, gap: 10 },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  completionBadge: { color: '#5EF58C', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, flexShrink: 1 },
  roomCode: { color: '#B5C7BA', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textAlign: 'right', flexShrink: 1 },
  heroTitle: { color: '#F4FFF6', fontSize: 30, fontWeight: '800', marginTop: 6 },
  heroSubtitle: { color: '#B5C7BA', fontSize: 14 },
  card: { backgroundColor: '#11261A', borderColor: '#245333', borderWidth: 1, borderRadius: 18, padding: 20 },
  label: { color: '#B5C7BA', fontSize: 11, fontWeight: '800', letterSpacing: 0.9 },
  distanceValue: { color: '#5EF58C', fontSize: 42, fontWeight: '800', marginTop: 12, lineHeight: 51 },
  detail: { color: '#9FB2A4', fontSize: 13, marginTop: 6, lineHeight: 19 },
  durationRow: { flexDirection: 'row', marginTop: 18, gap: 16 },
  durationColumn: { flex: 1, minWidth: 0 },
  columnLabel: { color: '#9FB2A4', fontSize: 12, fontWeight: '600' },
  durationValue: { color: '#F4FFF6', fontSize: 25, fontWeight: '800', marginTop: 6 },
  unavailableValue: { color: '#F5B942', fontSize: 20, fontWeight: '800', marginTop: 9 },
  notice: { color: '#D6AF5A', fontSize: 12, marginTop: 18, lineHeight: 18 },
  sectionTitle: { color: '#F4FFF6', fontSize: 19, fontWeight: '800' },
  emptyProfile: { minHeight: 142, marginTop: 18, borderRadius: 12, backgroundColor: '#0C1A10', borderColor: '#31503A', borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  warningSymbol: { color: '#F5B942', fontSize: 22, marginBottom: 6 },
  emptyProfileTitle: { color: '#F4FFF6', fontSize: 16, fontWeight: '800' },
  emptyProfileText: { color: '#9FB2A4', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  primaryButton: { backgroundColor: '#54E880', borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 4 },
  primaryButtonText: { color: '#09210F', fontSize: 15, fontWeight: '900', letterSpacing: 0.8 },
  secondaryButton: { borderColor: '#54E880', borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 6, alignSelf: 'stretch' },
  secondaryButtonText: { color: '#F0FDF4', fontSize: 15, fontWeight: '700' },
});

export default RideSummaryScreen;
