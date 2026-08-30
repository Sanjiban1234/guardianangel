import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Callout, Marker } from 'react-native-maps';
import { RouteRecommendation } from './types';

const META = { fuel: { icon: 'F', color: '#F59E0B', label: 'Fuel' }, food: { icon: 'E', color: '#8B5CF6', label: 'Food' }, workshops: { icon: 'W', color: '#0EA5E9', label: 'Workshop' } } as const;
export function formatRecommendationMeta(item: RouteRecommendation): string {
  const rating = item.rating == null ? 'Rating unavailable' : `${item.rating.toFixed(1)} ★`;
  const reviews = item.userRatingCount == null ? 'reviews unavailable' : `${item.userRatingCount} reviews`;
  return `${rating} • ${reviews}`;
}
export default function RecommendationMarker({ item }: { item: RouteRecommendation }) {
  const meta = META[item.category];
  return <Marker coordinate={{ latitude: item.latitude, longitude: item.longitude }} accessibilityLabel={`${meta.label} recommendation: ${item.name}`}>
    <View style={[styles.marker, { backgroundColor: meta.color }]}><Text style={styles.icon}>{meta.icon}</Text></View>
    <Callout tooltip><View style={styles.callout}>
      <Text style={styles.name}>{item.name}</Text><Text style={styles.category}>{meta.label}</Text>
      <Text style={styles.body}>{formatRecommendationMeta(item)}</Text>
      <Text style={styles.body}>{Math.round(item.distanceFromRouteMeters)} m from route</Text>
      <Text style={styles.reason}>{item.aiReason}</Text>
      <Text style={styles.safety}>Review recommendations before riding or while safely stopped.</Text>
    </View></Callout>
  </Marker>;
}
const styles = StyleSheet.create({ marker: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' }, icon: { color: '#FFF', fontWeight: '900' }, callout: { width: 245, padding: 12, borderRadius: 10, backgroundColor: '#142318' }, name: { color: '#F0FDF4', fontWeight: '900', fontSize: 15 }, category: { color: '#A3B8A8', fontWeight: '700', marginBottom: 6 }, body: { color: '#F0FDF4', fontSize: 12, marginTop: 2 }, reason: { color: '#D1FAE5', fontSize: 12, marginTop: 8 }, safety: { color: '#A3B8A8', fontSize: 10, marginTop: 8 } });
