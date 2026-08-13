import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
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

export interface RefuelAlertPayload {
  riderName: string;
  note?: string;
  timestamp: number;
}

interface RefuelNotificationModalProps {
  visible: boolean;
  riderName: string;
  isOnline: boolean;
  onClose: () => void;
  onSendRefuelAlert: (payload: RefuelAlertPayload) => void;
}

export function RefuelNotificationModal({
  visible,
  riderName,
  isOnline,
  onClose,
  onSendRefuelAlert,
}: RefuelNotificationModalProps) {
  const [note, setNote] = useState('');

  const handleInstantSend = () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Refill requests require a live group connection.');
      return;
    }
    onSendRefuelAlert({
      riderName,
      note: note.trim() || 'Need petrol stop soon.',
      timestamp: Date.now(),
    });
    setNote('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTag}>⛽ INFORMATIONAL REFUEL REQUEST</Text>
            <Text style={styles.urgencyLabel}>LOW URGENCY</Text>
          </View>

          <Text style={styles.modalTitle}>Request Petrol Stop</Text>
          <Text style={styles.modalCopy}>
            Inform your ride group that you need fuel soon. This is low-urgency and will not trigger emergency alarms.
          </Text>

          {/* QUICK TAP TARGET - ONE TAP SEND */}
          <Pressable onPress={handleInstantSend} style={styles.instantTapBtn}>
            <Text style={styles.instantTapBtnText}>⛽ Fast Tap Send: &quot;Need Fuel Soon&quot;</Text>
            <Text style={styles.instantTapSub}>Sends immediate notification to group without typing</Text>
          </Pressable>

          <Text style={styles.fieldLabel}>OPTIONAL SHORT NOTE FOR GROUP</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Range ~15km left, looking for 91 octane"
            placeholderTextColor="#5C7062"
            style={styles.input}
          />

          <View style={styles.actionRow}>
            <Pressable onPress={handleInstantSend} style={styles.sendWithNoteBtn}>
              <Text style={styles.sendWithNoteBtnText}>Send Refuel Alert →</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 12, 7, 0.85)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderColor: '#1D4ED8',
    borderTopWidth: 2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    gap: 12,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTag: { color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  urgencyLabel: {
    color: COLORS.green,
    backgroundColor: '#0F2B1A',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  modalTitle: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  modalCopy: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  instantTapBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
    marginVertical: 4,
  },
  instantTapBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 16 },
  instantTapSub: { color: '#092914', fontSize: 11, fontWeight: '700' },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 4 },
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
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  sendWithNoteBtn: {
    flex: 2,
    backgroundColor: COLORS.forest,
    borderColor: '#4ADE80',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendWithNoteBtnText: { color: COLORS.text, fontWeight: '800', fontSize: 14 },
  cancelBtn: {
    flex: 1,
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: { color: COLORS.muted, fontWeight: '700', fontSize: 14 },
});

export default RefuelNotificationModal;
