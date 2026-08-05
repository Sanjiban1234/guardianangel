import React, { useState } from 'react';
import {
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

export interface RiderProfileData {
  vehicleModel: string;
  plateNumber: string;
  vehicleColor: string;
  bloodGroup: string;
  allergies: string;
  emergencyContact: string;
  medicalNotes: string;
}

export const INITIAL_PROFILE_DATA: RiderProfileData = {
  vehicleModel: 'Bajaj Pulsar 150',
  plateNumber: 'BA 2 PA 1234',
  vehicleColor: 'Matte Black',
  bloodGroup: 'O+',
  allergies: 'Penicillin',
  emergencyContact: 'Sarah Vance (Sister) +1-555-0199',
  medicalNotes: 'No major surgical history. Wears prescription contacts.',
};

const BLOOD_GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'Skip / Unknown'];

interface RiderProfileScreenProps {
  initialData?: RiderProfileData;
  onSave: (data: RiderProfileData) => void;
  onCancel: () => void;
}

export function RiderProfileScreen({
  initialData = INITIAL_PROFILE_DATA,
  onSave,
  onCancel,
}: RiderProfileScreenProps) {
  const [vehicleModel, setVehicleModel] = useState(initialData.vehicleModel);
  const [plateNumber, setPlateNumber] = useState(initialData.plateNumber);
  const [vehicleColor, setVehicleColor] = useState(initialData.vehicleColor);
  const [bloodGroup, setBloodGroup] = useState(initialData.bloodGroup);
  const [allergies, setAllergies] = useState(initialData.allergies);
  const [emergencyContact, setEmergencyContact] = useState(initialData.emergencyContact);
  const [medicalNotes, setMedicalNotes] = useState(initialData.medicalNotes);

  const handleSave = () => {
    onSave({
      vehicleModel,
      plateNumber,
      vehicleColor,
      bloodGroup,
      allergies,
      emergencyContact,
      medicalNotes,
    });
  };

  const handleClearMedical = () => {
    setBloodGroup('Skip / Unknown');
    setAllergies('');
    setEmergencyContact('');
    setMedicalNotes('');
  };

  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable onPress={onCancel} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </Pressable>
          <Text style={styles.eyebrow}>RIDER PROFILE & SETTINGS</Text>
          <Text style={styles.title}>Vehicle & Medical ID</Text>
          <Text style={styles.subtitle}>
            Manage your ride details and emergency medical profile in one place.
          </Text>
        </View>

        {/* SECTION 1: VEHICLE INFORMATION */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>🏍️ Vehicle Details</Text>
            <Text style={styles.cardBadge}>AMBIENT / VISIBLE TO GROUP</Text>
          </View>
          <Text style={styles.cardCopy}>
            Vehicle information appears in the ride member roster and in breakdown reports so your group can identify your bike.
          </Text>

          <Text style={styles.fieldLabel}>VEHICLE MAKE & MODEL</Text>
          <TextInput
            value={vehicleModel}
            onChangeText={setVehicleModel}
            placeholder="e.g. Royal Enfield Himalayan 450"
            placeholderTextColor="#5C7062"
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>LICENSE PLATE NUMBER</Text>
          <TextInput
            value={plateNumber}
            onChangeText={setPlateNumber}
            placeholder="e.g. BA 2 PA 1234"
            placeholderTextColor="#5C7062"
            style={styles.input}
            autoCapitalize="characters"
          />

          <Text style={styles.fieldLabel}>VEHICLE COLOR</Text>
          <TextInput
            value={vehicleColor}
            onChangeText={setVehicleColor}
            placeholder="e.g. Pine Green / Black"
            placeholderTextColor="#5C7062"
            style={styles.input}
          />
        </View>

        {/* SECTION 2: MEDICAL ID (PRIVACY GATED) */}
        <View style={[styles.card, styles.medicalCard]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>🩸 Rider Medical ID</Text>
            <Text style={styles.privacyBadge}>GATED — SOS & BREAKDOWN ONLY</Text>
          </View>
          <Text style={styles.cardCopy}>
            Medical data is strictly optional. It is never displayed ambiently in group rosters and is only snapshot-attached during SOS emergency broadcasts and breakdown alerts.
          </Text>

          {/* BLOOD GROUP PICKER */}
          <Text style={styles.fieldLabel}>BLOOD GROUP</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
            {BLOOD_GROUPS.map(bg => (
              <Pressable
                key={bg}
                onPress={() => setBloodGroup(bg)}
                style={[
                  styles.pickerChip,
                  bloodGroup === bg && styles.pickerChipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.pickerChipText,
                    bloodGroup === bg && styles.pickerChipTextSelected,
                  ]}
                >
                  {bg}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* ALLERGIES & CONDITIONS */}
          <Text style={styles.fieldLabel}>ALLERGIES & KNOWN CONDITIONS (OPTIONAL)</Text>
          <TextInput
            value={allergies}
            onChangeText={setAllergies}
            placeholder="e.g. Penicillin, Bee stings, Latex"
            placeholderTextColor="#5C7062"
            style={styles.input}
          />

          {/* EMERGENCY CONTACT */}
          <Text style={styles.fieldLabel}>EMERGENCY CONTACT NAME & PHONE</Text>
          <TextInput
            value={emergencyContact}
            onChangeText={setEmergencyContact}
            placeholder="e.g. Sarah Vance +1-555-0199"
            placeholderTextColor="#5C7062"
            style={styles.input}
            keyboardType="phone-pad"
          />

          {/* ADDITIONAL MEDICAL NOTES */}
          <Text style={styles.fieldLabel}>ADDITIONAL MEDICAL NOTES</Text>
          <TextInput
            value={medicalNotes}
            onChangeText={setMedicalNotes}
            placeholder="e.g. Prescribed inhaler in left jacket pocket"
            placeholderTextColor="#5C7062"
            style={[styles.input, styles.multilineInput]}
            multiline
            numberOfLines={3}
          />

          <Pressable onPress={handleClearMedical} style={styles.clearLink}>
            <Text style={styles.clearLinkText}>Clear Medical ID fields (Keep optional)</Text>
          </Pressable>
        </View>

        {/* ACTIONS */}
        <View style={styles.actionGroup}>
          <Pressable onPress={handleSave} style={styles.saveButton}>
            <Text style={styles.saveButtonText}>Save Rider Profile & Settings</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Cancel / Skip for now</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink },
  scrollContent: { padding: 20, gap: 16 },
  header: { marginBottom: 4 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingRight: 12, marginBottom: 8 },
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
  medicalCard: {
    borderColor: '#2F4F38',
    backgroundColor: '#0E1A11',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  cardBadge: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  privacyBadge: {
    color: COLORS.amber,
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: '#382606',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  cardCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 6 },
  input: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
  },
  multilineInput: { height: 75, paddingTop: 10, textAlignVertical: 'top' },
  pickerRow: { flexDirection: 'row', marginVertical: 4 },
  pickerChip: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  pickerChipSelected: {
    backgroundColor: COLORS.forest,
    borderColor: '#4ADE80',
  },
  pickerChipText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  pickerChipTextSelected: { color: COLORS.text, fontWeight: '800' },
  clearLink: { marginTop: 6, alignSelf: 'center' },
  clearLinkText: { color: COLORS.muted, fontSize: 12, textDecorationLine: 'underline' },
  actionGroup: { gap: 10, marginTop: 8, marginBottom: 24 },
  saveButton: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  cancelButton: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: { color: COLORS.muted, fontWeight: '700', fontSize: 14 },
});

export default RiderProfileScreen;
