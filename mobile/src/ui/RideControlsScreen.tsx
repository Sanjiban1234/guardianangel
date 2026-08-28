import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  SafeAreaView,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { RiderSeparations } from '../separation/SeparationState';

interface RoomMember {
  user_id: string;
  name: string;
  isYou?: boolean;
  vehicleModel?: string;
  plateNumber?: string;
  connectionState?: 'CONNECTED' | 'DISCONNECTED';
  locationFreshness?: 'FRESH' | 'STALE';
}

interface RideControlsScreenProps {
  roomCode: string;
  riderName: string;
  currentUserId: string;
  connection: 'live' | 'offline';
  roomMembers: RoomMember[];
  refuelActive: boolean;
  refuelRiderName: string;
  refuelNote: string;
  breakdownActive: boolean;
  breakdownReason: string;
  breakdownNote: string;
  breakdownRiderName: string;
  breakdownVehicleModel: string;
  breakdownPlateNumber: string;
  separationsByRider: RiderSeparations;
  profile: any;
  onClose: () => void;
  onOpenRefuelModal: () => void;
  onResolveRefuel: () => void;
  onOpenBreakdownModal: () => void;
  onResolveBreakdown: () => void;
  onOpenProfile: () => void;
}

const COLORS = {
  ink: '#0B130E',
  card: '#142318',
  line: '#1E3A28',
  text: '#F0FDF4',
  muted: '#A3B8A8',
  blue: '#2F80ED',
  green: '#16A34A',
  amber: '#F59E0B',
  red: '#DC2626',
  darkInput: '#0F1A12',
};

const REASON_LABELS: Record<string, string> = {
  flat_tire: '🛞 Flat Tire',
  mechanical_failure: '⚙️ Mechanical Failure',
  fuel: '⛽ Fuel / Empty Tank',
  other: '⚠️ Other Mechanical Issue',
};

export default function RideControlsScreen({
  roomCode,
  riderName,
  currentUserId,
  connection,
  roomMembers,
  refuelActive,
  refuelRiderName,
  refuelNote,
  breakdownActive,
  breakdownReason,
  breakdownNote,
  breakdownRiderName,
  breakdownVehicleModel,
  breakdownPlateNumber,
  separationsByRider,
  profile,
  onClose,
  onOpenRefuelModal,
  onResolveRefuel,
  onOpenBreakdownModal,
  onResolveBreakdown,
  onOpenProfile,
}: RideControlsScreenProps) {
  const separations = Object.values(separationsByRider);
  const [copyConfirmationVisible, setCopyConfirmationVisible] = useState(false);

  const handleCopyCode = () => {
    Clipboard.setString(roomCode);
    setCopyConfirmationVisible(true);
    setTimeout(() => setCopyConfirmationVisible(false), 2_000);
  };

  const formatDistance = (meters: unknown) => {
    if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return null;
    return meters >= 1000
      ? `${(meters / 1000).toFixed(1)} km`
      : `${Math.round(meters)} m`;
  };

  const formatSpeed = (metersPerSecond: unknown) => {
    if (typeof metersPerSecond !== 'number' || !Number.isFinite(metersPerSecond) || metersPerSecond < 0) return null;
    return `${Math.round(metersPerSecond * 3.6)} km/h`;
  };

  const presenceFor = (member: RoomMember) => {
    if (member.isYou) {
      return connection === 'live'
        ? { label: 'Connected', color: COLORS.green }
        : { label: 'Reconnecting', color: COLORS.amber };
    }
    if (member.connectionState === 'DISCONNECTED') return { label: 'Disconnected', color: '#6B7280' };
    if (member.locationFreshness === 'STALE') return { label: 'Stale location', color: COLORS.amber };
    if (member.connectionState === 'CONNECTED' && member.locationFreshness === 'FRESH') {
      return { label: 'Connected', color: COLORS.green };
    }
    return { label: 'Status unknown', color: COLORS.muted };
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>GROUP {roomCode}</Text>
          <Text style={styles.title}>Ride Controls & Status</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy room code"
            onPress={handleCopyCode}
            style={styles.copyButton}
          >
            <Text style={styles.copyButtonText}>{copyConfirmationVisible ? 'Copied' : 'Copy code'}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕ Close</Text>
          </Pressable>
        </View>
      </View>

      {copyConfirmationVisible && <Text style={styles.copyConfirmation}>Room code copied</Text>}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* CONNECTION STATUS */}
        <View style={[styles.statusBanner, connection === 'live' ? styles.liveBanner : styles.offlineBanner]}>
          <View style={[styles.statusDot, { backgroundColor: connection === 'live' ? COLORS.green : COLORS.amber }]} />
          <Text style={styles.statusText}>
            {connection === 'live' ? 'CONNECTED — Socket active' : 'OFFLINE — Reconnecting...'}
          </Text>
        </View>

        {/* REFUEL ALERT */}
        {refuelActive && (
          <View style={styles.refuelBanner}>
            <View style={styles.alertHeader}>
              <Text style={styles.alertBadge}>⛽ REFUEL REQUEST</Text>
              <Pressable onPress={onResolveRefuel}>
                <Text style={styles.resolveButton}>Dismiss</Text>
              </Pressable>
            </View>
            <Text style={styles.alertMainText}>{refuelRiderName} needs petrol stop</Text>
            {refuelNote && <Text style={styles.alertNote}>"{refuelNote}"</Text>}
          </View>
        )}

        {/* BREAKDOWN ALERT */}
        {breakdownActive && (
          <View style={styles.breakdownBanner}>
            <View style={styles.alertHeader}>
              <Text style={styles.breakdownBadge}>⚠️ VEHICLE BREAKDOWN</Text>
              <Pressable onPress={onResolveBreakdown} style={styles.resolveBreakdownBtn}>
                <Text style={styles.resolveBreakdownText}>Clear</Text>
              </Pressable>
            </View>
            <Text style={styles.alertMainText}>{breakdownRiderName}</Text>
            {breakdownVehicleModel ? <Text style={styles.alertNote}>{breakdownVehicleModel}</Text> : null}
            {breakdownPlateNumber ? <Text style={styles.alertNote}>{breakdownPlateNumber}</Text> : null}
            <Text style={styles.breakdownReason}>{REASON_LABELS[breakdownReason] || breakdownReason}</Text>
            {breakdownNote && <Text style={styles.alertNote}>"{breakdownNote}"</Text>}
          </View>
        )}

        {/* SEPARATION ALERT */}
        {separations.map((separation) => {
          const rider = separation.separated_rider;
          const distance = formatDistance(rider?.distance_from_nearest_meters);
          const riderSpeed = formatSpeed(rider?.recommended_speed);
          const groupSpeed = formatSpeed(separation.group_recommendation?.recommended_speed);
          const isYou = rider?.user_id === currentUserId;
          return (
            <View key={rider?.user_id} style={styles.separationBanner}>
              <Text style={styles.separationBadge}>📍 GROUP SEPARATION</Text>
              <Text style={styles.alertMainText}>
                {isYou ? 'You are separated from the group' : `${rider?.name || 'A rider'} is separated`}
              </Text>
              {distance && <Text style={styles.separationDetail}>Distance: {distance}</Text>}
              {rider?.vehicle_model && <Text style={styles.alertNote}>{rider.vehicle_model}{rider.plate_number ? ` • ${rider.plate_number}` : ''}</Text>}
              {!rider?.vehicle_model && rider?.plate_number && <Text style={styles.alertNote}>{rider.plate_number}</Text>}
              {riderSpeed && <Text style={styles.separationGuidance}>Suggested rider speed: {riderSpeed}</Text>}
              {groupSpeed && <Text style={styles.separationGuidance}>Suggested group speed: {groupSpeed}</Text>}
            </View>
          );
        })}

        {/* GROUP ROSTER */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Group Roster ({roomMembers.length} {roomMembers.length === 1 ? 'Rider' : 'Riders'})
          </Text>
          {roomMembers.map((member) => {
            const presence = presenceFor(member);
            return (
              <View key={member.user_id} style={styles.rosterItem}>
                <View style={[styles.rosterDot, { backgroundColor: presence.color }]} />
                <Text style={styles.rosterName}>
                  {member.isYou || member.name === riderName ? `${riderName} (You)` : member.name}
                </Text>
                <Text style={[styles.rosterStatus, { color: presence.color }]}>{presence.label}</Text>
                {(member.vehicleModel || member.plateNumber) ? (
                  <Text style={styles.rosterVehicle}>
                    {[member.vehicleModel, member.plateNumber].filter(Boolean).join(' • ')}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* SAFETY CONTROLS */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Safety Controls</Text>

          <Pressable onPress={onOpenRefuelModal} style={styles.refuelButton}>
            <Text style={styles.refuelButtonText}>⛽ Request Fuel Stop</Text>
          </Pressable>

          <Pressable onPress={onOpenBreakdownModal} style={styles.breakdownButton}>
            <Text style={styles.breakdownButtonText}>⚠️ Report Vehicle Breakdown</Text>
          </Pressable>
        </View>

        {/* PROFILE LINK */}
        <Pressable onPress={onOpenProfile} style={styles.profileButton}>
          <Text style={styles.profileButtonText}>⚙️ Settings & Medical Profile</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  eyebrow: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  closeButton: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  copyButton: {
    backgroundColor: COLORS.green,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  copyButtonText: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  closeButtonText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  copyConfirmation: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  liveBanner: {
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
    borderColor: COLORS.green,
  },
  offlineBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: COLORS.amber,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  refuelBanner: {
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
    borderColor: COLORS.green,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  breakdownBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: COLORS.amber,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  separationBanner: {
    backgroundColor: 'rgba(47, 128, 237, 0.1)',
    borderColor: COLORS.blue,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertBadge: {
    color: COLORS.green,
    fontSize: 11,
    fontWeight: '800',
  },
  breakdownBadge: {
    color: COLORS.amber,
    fontSize: 11,
    fontWeight: '800',
  },
  separationBadge: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: '800',
  },
  resolveButton: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  resolveBreakdownBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  resolveBreakdownText: {
    color: COLORS.amber,
    fontSize: 11,
    fontWeight: '800',
  },
  alertMainText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  alertNote: {
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  breakdownReason: {
    color: COLORS.amber,
    fontSize: 12,
    fontWeight: '700',
  },
  separationGuidance: {
    color: COLORS.blue,
    fontSize: 12,
    fontWeight: '700',
  },
  separationDetail: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '800',
  },
  rosterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rosterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rosterName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  rosterStatus: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: '700',
  },
  rosterVehicle: {
    color: COLORS.muted,
    fontSize: 11,
    marginLeft: 18,
    flexBasis: '100%',
  },
  refuelButton: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  refuelButtonText: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  breakdownButton: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderColor: COLORS.amber,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  breakdownButtonText: {
    color: COLORS.amber,
    fontSize: 15,
    fontWeight: '900',
  },
  profileButton: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  profileButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
});
