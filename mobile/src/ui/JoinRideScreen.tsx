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
}

interface JoinRideScreenProps {
  initialCode?: string;
  onCancel: () => void;
  onConfirmJoin: (preview: RoomPreviewDetails) => void;
}

const MOCK_ROOM_DATABASE: Record<string, RoomPreviewDetails> = {
  'GA-8821': {
    groupCode: 'GA-8821',
    destinationTitle: 'Saturday Valley Loop — Nagarkot Viewpoint',
    locationName: 'Nagarkot Top Road, Bhaktapur',
    hostName: 'Alex Vance',
    activeRiderCount: 3,
    routeDistanceKm: 42.5,
  },
  'GA-9482': {
    groupCode: 'GA-9482',
    destinationTitle: 'Kakani Hill Ridge Run',
    locationName: 'Trishuli Highway, Nuwakot',
    hostName: 'Jordan Lee',
    activeRiderCount: 2,
    routeDistanceKm: 28.0,
  },
};

export function JoinRideScreen({
  initialCode = '',
  onCancel,
  onConfirmJoin,
}: JoinRideScreenProps) {
  const [inputCode, setInputCode] = useState(initialCode);
  const [parsedUrl, setParsedUrl] = useState('');
  const [preview, setPreview] = useState<RoomPreviewDetails | null>(
    initialCode && MOCK_ROOM_DATABASE[initialCode.toUpperCase()]
      ? MOCK_ROOM_DATABASE[initialCode.toUpperCase()]
      : null
  );

  const cleanCode = (raw: string): string => {
    // Extracts GA-XXXX or 6-char code from URLs or direct strings
    let code = raw.trim();
    if (code.includes('/ride/')) {
      code = code.split('/ride/')[1] || code;
    }
    return code.toUpperCase();
  };

  const handleLookupRoom = (raw: string) => {
    const code = cleanCode(raw);
    setInputCode(code);

    if (!code) {
      setPreview(null);
      return;
    }

    if (MOCK_ROOM_DATABASE[code]) {
      setPreview(MOCK_ROOM_DATABASE[code]);
    } else {
      // Fallback dynamic preview for demo custom codes
      setPreview({
        groupCode: code,
        destinationTitle: 'Group Ride Endpoint',
        locationName: 'Destination set by host',
        hostName: 'Ride Creator',
        activeRiderCount: 1,
        routeDistanceKm: 35.0,
      });
    }
  };

  const handlePasteSharedLink = () => {
    const sampleLink = 'https://guardianangel.app/ride/GA-8821';
    setParsedUrl(sampleLink);
    handleLookupRoom(sampleLink);
  };

  const handleConfirm = () => {
    if (!preview) {
      Alert.alert('Invalid Code', 'Please enter a valid ride room group code.');
      return;
    }
    onConfirmJoin(preview);
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
          <Text style={styles.title}>Enter Code or Open Link</Text>
          <Text style={styles.subtitle}>
            Enter the 6-character ride room group code or paste a shared invite link to join your group.
          </Text>
        </View>

        {/* INPUT CARD */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>GROUP CODE OR SHAREABLE LINK</Text>
          <TextInput
            value={inputCode}
            onChangeText={handleLookupRoom}
            placeholder="e.g. GA-8821 or paste link"
            placeholderTextColor="#5C7062"
            style={styles.codeInput}
            autoCapitalize="characters"
          />

          {/* SIMULATED DEEP LINK PASTE BUTTON */}
          <Pressable onPress={handlePasteSharedLink} style={styles.pasteBtn}>
            <Text style={styles.pasteBtnText}>🔗 Simulate Deep-Link Paste (GA-8821)</Text>
          </Pressable>
        </View>

        {/* ROOM DESTINATION PREVIEW CARD */}
        {preview ? (
          <View style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewBadge}>✓ ROOM FOUND</Text>
              <Text style={styles.codeText}>{preview.groupCode}</Text>
            </View>

            <Text style={styles.destinationTitle}>🏁 {preview.destinationTitle}</Text>
            <Text style={styles.locationName}>📍 {preview.locationName}</Text>

            <View style={styles.metaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>HOST / CREATOR</Text>
                <Text style={styles.metaValue}>👤 {preview.hostName}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>ACTIVE RIDERS</Text>
                <Text style={styles.metaValue}>🏍️ {preview.activeRiderCount} Members</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>EST. DISTANCE</Text>
                <Text style={styles.metaValue}>🛣️ {preview.routeDistanceKm} km</Text>
              </View>
            </View>

            {/* MAP PIN PREVIEW */}
            <View style={styles.mapMiniCanvas}>
              <Text style={styles.mapMiniText}>🗺️ TARGET DESTINATION PREVIEW PIN</Text>
              <Text style={styles.mapMiniSub}>Live telemetry sync will start upon joining</Text>
            </View>

            {/* JOIN ACTION BUTTON */}
            <Pressable onPress={handleConfirm} style={styles.joinBtn}>
              <Text style={styles.joinBtnText}>Confirm & Join Group Tracking Map →</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>Enter a valid room code</Text>
            <Text style={styles.emptyCopy}>
              Ask your ride leader for the 6-character group code (e.g. GA-8821) to preview room details.
            </Text>
          </View>
        )}
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
    gap: 10,
  },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  codeInput: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1.5,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  pasteBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  pasteBtnText: { color: COLORS.blue, fontSize: 13, fontWeight: '700' },
  previewCard: {
    backgroundColor: COLORS.card,
    borderColor: '#224830',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewBadge: {
    color: COLORS.green,
    backgroundColor: '#0E2A18',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  codeText: { color: COLORS.text, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  destinationTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  locationName: { color: COLORS.muted, fontSize: 13, marginTop: -6 },
  metaGrid: {
    flexDirection: 'row',
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    justifyContent: 'space-between',
  },
  metaItem: { gap: 2 },
  metaLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  metaValue: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  mapMiniCanvas: {
    backgroundColor: '#0F1E14',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 2,
  },
  mapMiniText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  mapMiniSub: { color: COLORS.muted, fontSize: 11 },
  joinBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  joinBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyIcon: { fontSize: 32, marginBottom: 4 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  emptyCopy: { color: COLORS.muted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
});

export default JoinRideScreen;
