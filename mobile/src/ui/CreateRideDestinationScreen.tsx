import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
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

export interface RideDestination {
  title: string;
  locationName: string;
  latitude: number;
  longitude: number;
}

export interface CreatedRoomData {
  groupCode: string;
  shareableUrl: string;
  destination: RideDestination;
  creatorName: string;
}

interface CreateRideDestinationScreenProps {
  creatorName: string;
  onCancel: () => void;
  onConfirmAndStartRide: (roomData: CreatedRoomData) => void;
}

const PRESET_DESTINATIONS: RideDestination[] = [
  {
    title: 'Nagarkot Scenic Viewpoint',
    locationName: 'Nagarkot Top Road, Bhaktapur',
    latitude: 27.7172,
    longitude: 85.5204,
  },
  {
    title: 'Kakani Hill Station',
    locationName: 'Trishuli Highway, Nuwakot',
    latitude: 27.8078,
    longitude: 85.2536,
  },
  {
    title: 'Dhulikhel Heights Viewpoint',
    locationName: 'Arniko Highway, Kavre',
    latitude: 27.6253,
    longitude: 85.5561,
  },
];

function generateGroupCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GA-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function CreateRideDestinationScreen({
  creatorName,
  onCancel,
  onConfirmAndStartRide,
}: CreateRideDestinationScreenProps) {
  const [selectedDestination, setSelectedDestination] = useState<RideDestination>(PRESET_DESTINATIONS[0]);
  const [customTitle, setCustomTitle] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Room generation state
  const [generatedRoom, setGeneratedRoom] = useState<CreatedRoomData | null>(null);

  const handleSelectPreset = (dest: RideDestination) => {
    setIsCustomMode(false);
    setSelectedDestination(dest);
  };

  const handleConfirmDestination = () => {
    let finalDest = selectedDestination;
    if (isCustomMode) {
      if (!customTitle.trim()) {
        Alert.alert('Missing Field', 'Please enter a destination name.');
        return;
      }
      finalDest = {
        title: customTitle.trim(),
        locationName: customLocation.trim() || 'Custom Coordinates',
        latitude: 27.7007,
        longitude: 85.3001,
      };
    }

    const code = generateGroupCode();
    const url = `https://guardianangel.app/ride/${code}`;

    setGeneratedRoom({
      groupCode: code,
      shareableUrl: url,
      destination: finalDest,
      creatorName,
    });
  };

  const handleNativeShare = async () => {
    if (!generatedRoom) return;
    try {
      await Share.share({
        title: `Join my ride to ${generatedRoom.destination.title}`,
        message: `🏍️ Join my ride group on Guardian Angel!\nDestination: ${generatedRoom.destination.title}\nGroup Code: ${generatedRoom.groupCode}\n\nJoin link: ${generatedRoom.shareableUrl}`,
        url: generatedRoom.shareableUrl,
      });
    } catch (err) {
      Alert.alert('Share Error', 'Could not open native share sheet.');
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
          <Text style={styles.eyebrow}>STEP 1: CREATE RIDE SESSION</Text>
          <Text style={styles.title}>Destination & Room Setup</Text>
          <Text style={styles.subtitle}>
            Set the target destination for your group and generate a shareable group code.
          </Text>
        </View>

        {!generatedRoom ? (
          <>
            {/* STEP 1: DESTINATION SELECTION */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📍 Select Destination</Text>
              <Text style={styles.cardCopy}>
                Choose from popular motorcycle endpoints or set a custom location pin.
              </Text>

              {/* PRESET CHIPS */}
              <View style={styles.presetList}>
                {PRESET_DESTINATIONS.map(dest => {
                  const isSelected = !isCustomMode && selectedDestination.title === dest.title;
                  return (
                    <Pressable
                      key={dest.title}
                      onPress={() => handleSelectPreset(dest)}
                      style={[styles.presetCard, isSelected && styles.presetCardSelected]}
                    >
                      <View style={styles.presetHeader}>
                        <Text style={[styles.presetTitle, isSelected && styles.presetTitleSelected]}>
                          {isSelected ? '🎯 ' : '⛰️ '}{dest.title}
                        </Text>
                        {isSelected && <Text style={styles.selectedBadge}>SELECTED PIN</Text>}
                      </View>
                      <Text style={styles.presetLocation}>{dest.locationName}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* CUSTOM LOCATION TOGGLE */}
              <Pressable
                onPress={() => setIsCustomMode(!isCustomMode)}
                style={styles.customToggleBtn}
              >
                <Text style={styles.customToggleText}>
                  {isCustomMode ? '✓ Custom location mode active' : '+ Specify custom destination name'}
                </Text>
              </Pressable>

              {isCustomMode && (
                <View style={styles.customForm}>
                  <Text style={styles.fieldLabel}>DESTINATION TITLE *</Text>
                  <TextInput
                    value={customTitle}
                    onChangeText={setCustomTitle}
                    placeholder="e.g. Trishuli River Resort"
                    placeholderTextColor="#5C7062"
                    style={styles.input}
                  />

                  <Text style={styles.fieldLabel}>LOCATION / LANDMARK NOTE</Text>
                  <TextInput
                    value={customLocation}
                    onChangeText={setCustomLocation}
                    placeholder="e.g. Highway KM 45 Gate"
                    placeholderTextColor="#5C7062"
                    style={styles.input}
                  />
                </View>
              )}
            </View>

            {/* MAP PICKER PREVIEW */}
            <View style={styles.mapPreviewCard}>
              <View style={styles.mapCanvas}>
                <View style={styles.mapPinContainer}>
                  <View style={styles.mapPinCircle}>
                    <Text style={styles.mapPinText}>📍</Text>
                  </View>
                  <View style={styles.mapPinCallout}>
                    <Text style={styles.mapPinCalloutTitle}>
                      {isCustomMode ? customTitle || 'Custom Destination' : selectedDestination.title}
                    </Text>
                    <Text style={styles.mapPinCalloutSub}>Target Group Endpoint</Text>
                  </View>
                </View>
                <Text style={styles.mapOverlayLabel}>GOOGLE MAPS INTEGRATION</Text>
              </View>
            </View>

            <Pressable onPress={handleConfirmDestination} style={styles.confirmBtn}>
              <Text style={styles.confirmBtnText}>Confirm Destination & Generate Code →</Text>
            </Pressable>
          </>
        ) : (
          /* STEP 2: ROOM CODE & LINK GENERATED SCREEN */
          <View style={styles.generatedCard}>
            <View style={styles.successBadgeRow}>
              <Text style={styles.successBadge}>✓ ROOM CREATED</Text>
              <Text style={styles.autoMemberTag}>AUTO-ADDED AS LEAD MEMBER</Text>
            </View>

            <Text style={styles.destTitle}>
              🏁 {generatedRoom.destination.title}
            </Text>
            <Text style={styles.destSub}>{generatedRoom.destination.locationName}</Text>

            {/* ROOM CODE DISPLAY BOX */}
            <View style={styles.codeBox}>
              <Text style={styles.codeBoxLabel}>YOUR RIDE ROOM GROUP CODE</Text>
              <Text style={styles.codeBoxCode}>{generatedRoom.groupCode}</Text>
              <Text style={styles.codeBoxSub}>Share this code with riders joining manually.</Text>
            </View>

            {/* SHAREABLE LINK BOX */}
            <View style={styles.linkBox}>
              <Text style={styles.linkBoxLabel}>SHAREABLE DEEP-LINK</Text>
              <Text style={styles.linkBoxUrl}>{generatedRoom.shareableUrl}</Text>
            </View>

            {/* NATIVE SHARE BUTTON */}
            <Pressable onPress={handleNativeShare} style={styles.shareSheetBtn}>
              <Text style={styles.shareSheetBtnText}>📱 Open Native Share Sheet</Text>
            </Pressable>

            {/* ROSTER PREVIEW */}
            <View style={styles.rosterCard}>
              <Text style={styles.rosterTitle}>Room Members (1 Rider)</Text>
              <View style={styles.rosterMemberRow}>
                <View style={styles.leadDot} />
                <Text style={styles.rosterMemberName}>{generatedRoom.creatorName} (Host / Lead)</Text>
                <Text style={styles.leadBadge}>LEAD</Text>
              </View>
            </View>

            {/* START RIDE TRACKING BUTTON */}
            <Pressable
              onPress={() => onConfirmAndStartRide(generatedRoom)}
              style={styles.startTrackingBtn}
            >
              <Text style={styles.startTrackingBtnText}>Start Live Group Tracking Map →</Text>
            </Pressable>
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
    gap: 12,
  },
  cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  cardCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  presetList: { gap: 10 },
  presetCard: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  presetCardSelected: {
    backgroundColor: '#173622',
    borderColor: '#4ADE80',
    borderWidth: 1.5,
  },
  presetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  presetTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  presetTitleSelected: { color: '#F0FDF4', fontWeight: '900' },
  selectedBadge: {
    color: COLORS.green,
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: '#0F2918',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  presetLocation: { color: COLORS.muted, fontSize: 12 },
  customToggleBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  customToggleText: { color: COLORS.blue, fontSize: 13, fontWeight: '700' },
  customForm: { gap: 8, marginTop: 4 },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  input: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    fontSize: 14,
  },
  mapPreviewCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    height: 160,
  },
  mapCanvas: {
    flex: 1,
    backgroundColor: '#0B1710',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  mapPinContainer: { alignItems: 'center', gap: 6 },
  mapPinCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.forest,
    borderColor: COLORS.blue,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapPinText: { fontSize: 20 },
  mapPinCallout: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  mapPinCalloutTitle: { color: COLORS.text, fontSize: 13, fontWeight: '800' },
  mapPinCalloutSub: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  mapOverlayLabel: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    opacity: 0.7,
  },
  confirmBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  confirmBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  generatedCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  successBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  successBadge: {
    color: COLORS.green,
    backgroundColor: '#0E2A18',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  autoMemberTag: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  destTitle: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  destSub: { color: COLORS.muted, fontSize: 13, marginTop: -10 },
  codeBox: {
    backgroundColor: '#0F1E14',
    borderColor: '#224830',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  codeBoxLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  codeBoxCode: { color: COLORS.text, fontSize: 34, fontWeight: '900', letterSpacing: 4 },
  codeBoxSub: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  linkBox: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  linkBoxLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  linkBoxUrl: { color: COLORS.blue, fontSize: 13, fontWeight: '700' },
  shareSheetBtn: {
    backgroundColor: COLORS.blue,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  shareSheetBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  rosterCard: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  rosterTitle: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  rosterMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  leadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.green },
  rosterMemberName: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '700' },
  leadBadge: {
    color: COLORS.green,
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: '#0F2918',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  startTrackingBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  startTrackingBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
});

export default CreateRideDestinationScreen;
