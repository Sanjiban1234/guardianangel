import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const COLORS = {
  forest: '#14532D',
  blue: '#2F80ED',
  amber: '#F59E0B',
  red: '#DC2626',
  green: '#16A34A',
  ink: '#0B130E',
  card: '#142318',
  line: '#1E3A28',
  text: '#F0FDF4',
  muted: '#A3B8A8',
  darkInput: '#0F1A12',
};

export interface RoomPreviewDetails {
  groupCode: string;
  destinationTitle: string;
  locationName: string;
  hostName: string;
  activeRiderCount: number;
  routeDistanceKm: number;
  destination?: {
    latitude: number;
    longitude: number;
    label?: string | null;
  };
}

interface JoinRideScreenProps {
  initialCode?: string;
  apiBaseUrl: string;
  authToken: string;
  isOnline?: boolean;
  onCancel: () => void;
  onConfirmJoin: (preview: RoomPreviewDetails) => void;
}

export function JoinRideScreen({
  initialCode = '',
  apiBaseUrl,
  authToken,
  isOnline,
  onCancel,
  onConfirmJoin,
}: JoinRideScreenProps) {
  const [inputCode, setInputCode] = useState(initialCode);
  const [isJoining, setIsJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const cleanCode = (raw: string): string => {
    let code = raw.trim();
    if (code.includes('/ride/')) {
      code = code.split('/ride/')[1] || code;
    }
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  };

  const formatJoinError = (status: number, body: any): string => {
    switch (status) {
      case 400:
        if (body?.code === 'ROOM_ENDED') return 'This ride group has already ended.';
        if (body?.code === 'ROOM_EXPIRED') return 'This ride group has expired. Ask the host to create a new one.';
        if (body?.code === 'INVALID_GROUP_CODE') return 'Invalid room code format. Use a 12-character alphanumeric code.';
        return body?.error || 'Invalid request. Check the room code and try again.';
      case 401:
        return 'Session expired. Please log in again.';
      case 403:
        return body?.code === 'PROFILE_INCOMPLETE'
          ? 'Complete your rider profile before joining a ride.'
          : 'You are not authorized to join this ride.';
      case 404:
        return 'Room not found. Check the room code and try again.';
      case 409:
        if (body?.code === 'ROOM_FULL') return 'This ride group is full (max 20 riders).';
        if (body?.code === 'ALREADY_MEMBER') return '__ALREADY_MEMBER__';
        return body?.error || 'Cannot join this ride group.';
      case 410:
        return 'This ride group has expired. Ask the host to create a new one.';
      case 503:
        return 'Server is unavailable. Please try again later.';
      default:
        return body?.error || 'Unable to join ride room. Please try again.';
    }
  };

  const handleConfirm = async () => {
    const groupCode = cleanCode(inputCode);
    if (!groupCode || groupCode.length < 4) {
      setErrorMsg('Please enter a valid ride room group code (e.g. 32A3BB1ECB08)');
      return;
    }

    if (isOnline === false) {
      setErrorMsg('You are offline. Please connect to the internet to join a ride.');
      return;
    }

    setIsJoining(true);
    setErrorMsg('');

    try {
      const response = await fetch(`${apiBaseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ group_code: groupCode }),
      });
      const body = await response.json();

      if (!response.ok) {
        const message = formatJoinError(response.status, body);

        if (message === '__ALREADY_MEMBER__') {
          onConfirmJoin({
            groupCode,
            destinationTitle: body.destination?.label || 'Group Ride',
            locationName: `Room ${body.room_id || groupCode}`,
            hostName: 'Unknown',
            activeRiderCount: 0,
            routeDistanceKm: 0,
            destination: body.destination
              ? { latitude: body.destination.latitude, longitude: body.destination.longitude, label: body.destination.label }
              : undefined,
          });
          return;
        }

        setErrorMsg(message);
        return;
      }

      if (!body?.room_id) {
        setErrorMsg('Server returned an unexpected response. Please try again.');
        return;
      }

      onConfirmJoin({
        groupCode,
        destinationTitle: body.destination?.label || 'Group Ride',
        locationName: `Room ${body.room_id}`,
        hostName: 'Unknown',
        activeRiderCount: 0,
        routeDistanceKm: 0,
        destination: body.destination
          ? { latitude: body.destination.latitude, longitude: body.destination.longitude, label: body.destination.label }
          : undefined,
      });
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? `Network error: ${error.message}. Check your connection and try again.`
          : 'Unable to join ride room. Check your connection and try again.',
      );
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable onPress={onCancel} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back to Portal</Text>
          </Pressable>
          <Text style={styles.eyebrow}>JOIN GROUP RIDE</Text>
          <Text style={styles.title}>Enter Group Code</Text>
          <Text style={styles.subtitle}>
            Enter the group code generated by the ride leader (e.g. 12-character hex code) to join the live tracking map.
          </Text>
        </View>

        {/* INPUT CARD */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>GROUP INVITE CODE</Text>
          <TextInput
            value={inputCode}
            onChangeText={(text) => {
              setInputCode(cleanCode(text));
              setErrorMsg('');
            }}
            placeholder="e.g. 32A3BB1ECB08"
            placeholderTextColor="#5C7062"
            style={styles.codeInput}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleConfirm}
            disabled={isJoining || inputCode.trim().length === 0}
            style={[
              styles.joinBtn,
              (isJoining || inputCode.trim().length === 0) ? styles.joinBtnDisabled : null,
            ]}
          >
            <Text style={styles.joinBtnText}>
              {isJoining ? 'Joining Group Ride...' : 'Join Group Ride →'}
            </Text>
          </Pressable>
        </View>

        {/* HELPER CARD */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>💡 Live Telemetry & Safety</Text>
          <Text style={styles.infoCopy}>
            Joining a ride room connects you to the live WebSocket network. You and other riders in the group will share GPS positions, fuel stop alerts, breakdown notices, and emergency crash warnings in real-time.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink },
  scrollContent: { padding: 20, gap: 16 },
  header: { marginBottom: 4 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingRight: 12, marginBottom: 6 },
  backButtonText: { color: COLORS.blue, fontWeight: '700', fontSize: 14 },
  eyebrow: { color: '#86EFAC', fontWeight: '800', fontSize: 11, letterSpacing: 1.1 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800', marginTop: 2 },
  subtitle: { color: COLORS.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 14,
  },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  codeInput: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1.5,
    borderRadius: 12,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: 14,
    height: 52,
    letterSpacing: 1.5,
  },
  errorBox: {
    backgroundColor: '#3B0A0A',
    borderColor: COLORS.red,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  errorText: { color: '#FCA5A5', fontSize: 12, fontWeight: '600', lineHeight: 16 },
  joinBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  joinBtnDisabled: { opacity: 0.5 },
  joinBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.3 },
  infoCard: {
    backgroundColor: '#102A1A',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  infoTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  infoCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
});

export default JoinRideScreen;
