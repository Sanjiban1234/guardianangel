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

export interface RiderProfileData {
  username: string;
  vehicleModel: string;
  plateNumber: string;
  vehicleColor: string;
  bloodGroup: string;
  allergies: string;
  emergencyContact: string;
  medicalNotes: string;
  shareMedicalDuringEmergency: boolean;
  shareEmergencyContactDuringEmergency: boolean;
}

export const INITIAL_PROFILE_DATA: RiderProfileData = {
  username: '',
  vehicleModel: '',
  plateNumber: '',
  vehicleColor: '',
  bloodGroup: 'Skip / Unknown',
  allergies: '',
  emergencyContact: '',
  medicalNotes: '',
  shareMedicalDuringEmergency: false,
  shareEmergencyContactDuringEmergency: false,
};

const BLOOD_GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'Skip / Unknown'];

interface RiderProfileScreenProps {
  initialData?: RiderProfileData;
  apiBaseUrl: string;
  authToken: string;
  isOnline: boolean;
  onSave: (data: RiderProfileData) => void;
  onUsernameChanged: (username: string) => void;
  onCancel: () => void;
}

export function RiderProfileScreen({
  initialData = INITIAL_PROFILE_DATA,
  apiBaseUrl,
  authToken,
  isOnline,
  onSave,
  onUsernameChanged,
  onCancel,
}: RiderProfileScreenProps) {
  const [username, setUsername] = useState(initialData.username);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [usernameError, setUsernameError] = useState('');
  const [vehicleModel, setVehicleModel] = useState(initialData.vehicleModel);
  const [plateNumber, setPlateNumber] = useState(initialData.plateNumber);
  const [vehicleColor, setVehicleColor] = useState(initialData.vehicleColor);
  const [bloodGroup, setBloodGroup] = useState(initialData.bloodGroup);
  const [allergies, setAllergies] = useState(initialData.allergies);
  const [emergencyContact, setEmergencyContact] = useState(initialData.emergencyContact);
  const [medicalNotes, setMedicalNotes] = useState(initialData.medicalNotes);
  const [shareMedicalDuringEmergency, setShareMedicalDuringEmergency] = useState(initialData.shareMedicalDuringEmergency);
  const [shareEmergencyContactDuringEmergency, setShareEmergencyContactDuringEmergency] = useState(initialData.shareEmergencyContactDuringEmergency);

  const handleChangeUsername = async () => {
    const nextUsername = username.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(nextUsername) || ['admin', 'support', 'guardianangel', 'api'].includes(nextUsername)) {
      setUsernameStatus('error');
      setUsernameError('Username must be 3–32 characters, start with a letter, and use only letters, numbers, or underscores.');
      return;
    }
    if (!isOnline) { setUsernameStatus('error'); setUsernameError('Username changes require a live connection.'); return; }
    setUsernameStatus('saving');
    setUsernameError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/users/username`, { method: 'PUT', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: nextUsername }) });
      const body = await response.json();
      if (!response.ok || typeof body.username !== 'string') throw new Error(body.error || 'Unable to update username');
      setUsername(body.username);
      onUsernameChanged(body.username);
      setUsernameStatus('success');
    } catch (error) {
      setUsernameStatus('error');
      setUsernameError(error instanceof Error ? error.message : 'Unable to update username');
    }
  };

  const handleSave = async () => {
    const data = {
      username,
      vehicleModel,
      plateNumber,
      vehicleColor,
      bloodGroup,
      allergies,
      emergencyContact,
      medicalNotes,
      shareMedicalDuringEmergency,
      shareEmergencyContactDuringEmergency,
    };
    if (!isOnline) {
      Alert.alert('Offline', 'Profile changes require a live connection and were not saved.');
      return;
    }
    const phoneMatch = emergencyContact.match(/(\+[1-9]\d{1,14})\s*$/);
    try {
      const vehicleResponse = await fetch(`${apiBaseUrl}/api/users/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_model: vehicleModel, plate_number: plateNumber, vehicle_color: vehicleColor }),
      });
      const vehicleBody = await vehicleResponse.json();
      if (!vehicleResponse.ok) throw new Error(vehicleBody.error || 'Unable to save vehicle details');

      const medicalResponse = await fetch(`${apiBaseUrl}/api/users/medical-info`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blood_group: bloodGroup === 'Skip / Unknown' ? undefined : bloodGroup,
          allergies: allergies || undefined,
          emergency_contact_name: phoneMatch ? emergencyContact.slice(0, phoneMatch.index).trim() : emergencyContact || undefined,
          emergency_contact_phone: phoneMatch?.[1],
          notes: medicalNotes || undefined,
          share_medical_during_emergency: shareMedicalDuringEmergency,
          share_emergency_contact_during_emergency: shareEmergencyContactDuringEmergency,
        }),
      });
      const medicalBody = await medicalResponse.json();
      if (!medicalResponse.ok) throw new Error(medicalBody.error || 'Unable to save medical ID');
      const medical = medicalBody.medical_info || {};
      const contact = [medical.emergency_contact_name, medical.emergency_contact_phone].filter(Boolean).join(' ');
      onSave({
        ...data,
        username,
        vehicleModel: vehicleBody.profile.vehicle_model || '',
        plateNumber: vehicleBody.profile.plate_number || '',
        vehicleColor: vehicleBody.profile.vehicle_color || '',
        bloodGroup: medical.blood_group || 'Skip / Unknown',
        allergies: medical.allergies || '',
        emergencyContact: contact,
        medicalNotes: medical.notes || '',
        shareMedicalDuringEmergency: medical.share_medical_during_emergency === true,
        shareEmergencyContactDuringEmergency: medical.share_emergency_contact_during_emergency === true,
      });
    } catch (error) {
      Alert.alert('Save Failed', error instanceof Error ? error.message : 'Unable to save medical ID.');
    }
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account Settings</Text>
          <Text style={styles.cardCopy}>Your username is your public handle for friends and ride invitations. Your email remains private.</Text>
          <Text style={styles.fieldLabel}>CURRENT USERNAME</Text>
          <TextInput value={username} onChangeText={value => { setUsername(value); setUsernameStatus('idle'); setUsernameError(''); }} placeholder="e.g. alex_rides" placeholderTextColor="#5C7062" style={styles.input} autoCapitalize="none" autoCorrect={false} maxLength={32} />
          {usernameStatus === 'success' ? <Text style={styles.successText}>Username updated.</Text> : null}
          {usernameStatus === 'error' ? <Text style={styles.errorText}>{usernameError}</Text> : null}
          <Pressable onPress={handleChangeUsername} disabled={usernameStatus === 'saving'} style={[styles.usernameButton, usernameStatus === 'saving' && styles.buttonDisabled]}><Text style={styles.usernameButtonText}>{usernameStatus === 'saving' ? 'Updating username…' : 'Change Username'}</Text></Pressable>
        </View>

        {/* SECTION 1: VEHICLE INFORMATION */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>🏍️ Vehicle Details</Text>
            <Text style={styles.cardBadge}>ACCOUNT PROFILE</Text>
          </View>
          <Text style={styles.cardCopy}>
            Registered vehicle details identify you to members of your active ride.
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
            Medical data is optional and never displayed in group rosters. It is only shared after a confirmed SOS when you explicitly enable a category below.
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

          <Pressable onPress={() => setShareMedicalDuringEmergency((value) => !value)} style={styles.consentRow}>
            <Text style={styles.consentText}>{shareMedicalDuringEmergency ? '☑' : '☐'} Share medical information during an emergency</Text>
            <Text style={styles.consentCopy}>Shares blood group and allergies with riders in your active group after a confirmed SOS.</Text>
          </Pressable>
          <Pressable onPress={() => setShareEmergencyContactDuringEmergency((value) => !value)} style={styles.consentRow}>
            <Text style={styles.consentText}>{shareEmergencyContactDuringEmergency ? '☑' : '☐'} Share emergency contact during an emergency</Text>
            <Text style={styles.consentCopy}>Shares your contact name and phone only after a confirmed SOS.</Text>
          </Pressable>

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
  scrollContent: { paddingHorizontal: 16, paddingVertical: 20, gap: 16, width: '100%', maxWidth: 640, alignSelf: 'center' },
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
  errorText: { color: COLORS.red, fontSize: 11, fontWeight: '600', marginTop: 2 },
  successText: { color: '#86EFAC', fontSize: 12, fontWeight: '700' },
  usernameButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F2918', borderColor: '#16A34A', borderWidth: 1, borderRadius: 12, marginTop: 4 },
  usernameButtonText: { color: '#86EFAC', fontSize: 14, fontWeight: '800' },
  buttonDisabled: { opacity: 0.6 },
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
  consentRow: { backgroundColor: COLORS.darkInput, borderRadius: 10, padding: 12, gap: 4 },
  consentText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  consentCopy: { color: COLORS.muted, fontSize: 11, lineHeight: 15 },
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
