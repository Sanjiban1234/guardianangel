import React from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
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

export interface WaitingMember {
  user_id: string;
  name: string;
  role?: string;
  isYou?: boolean;
}

interface WaitingRoomScreenProps {
  roomCode: string;
  destinationTitle: string;
  members: WaitingMember[];
  isHost: boolean;
  onStartRide?: () => void;
  onLeaveRoom: () => void;
}

export default function WaitingRoomScreen({
  roomCode,
  destinationTitle,
  members,
  isHost,
  onStartRide,
  onLeaveRoom,
}: WaitingRoomScreenProps) {
  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Pressable onPress={onLeaveRoom} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Leave Room</Text>
          </Pressable>
          <Text style={styles.eyebrow}>WAITING FOR RIDE TO START</Text>
          <Text style={styles.title}>{destinationTitle || 'Group Ride'}</Text>
        </View>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>ROOM CODE</Text>
          <Text style={styles.codeValue}>{roomCode}</Text>
          <Text style={styles.codeHint}>Share this code with riders to join</Text>
        </View>

        <View style={styles.memberCard}>
          <View style={styles.memberHeader}>
            <Text style={styles.memberTitle}>Riders in Room</Text>
            <Text style={styles.memberCount}>{members.length}</Text>
          </View>

          {members.length === 0 ? (
            <Text style={styles.emptyText}>No riders have joined yet.</Text>
          ) : (
            <View style={styles.memberList}>
              {members.map((member) => (
                <View key={member.user_id} style={styles.memberRow}>
                  <View
                    style={[
                      styles.memberDot,
                      member.role === 'owner' ? styles.hostDot : styles.riderDot,
                    ]}
                  />
                  <Text style={styles.memberName}>
                    {member.name}
                    {member.isYou ? ' (You)' : ''}
                  </Text>
                  {member.role === 'owner' && (
                    <Text style={styles.hostBadge}>HOST</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {isHost && onStartRide && (
          <Pressable onPress={() => { onStartRide(); }} style={styles.startBtn}>
            <Text style={styles.startBtnText}>Start Ride →</Text>
          </Pressable>
        )}

        {!isHost && (
          <View style={styles.waitingBanner}>
            <Text style={styles.waitingText}>
              Waiting for host to start the ride...
            </Text>
          </View>
        )}

        <Text style={styles.hint}>
          {isHost
            ? 'Tap "Start Ride" when all riders have joined.'
            : 'The host will start the ride shortly. Stay on this screen.'}
        </Text>
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

  codeCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 6,
  },
  codeLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  codeValue: { color: COLORS.text, fontSize: 30, fontWeight: '900', letterSpacing: 4 },
  codeHint: { color: COLORS.muted, fontSize: 11 },

  memberCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  memberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memberTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  memberCount: { color: COLORS.green, fontSize: 14, fontWeight: '800' },
  emptyText: { color: COLORS.muted, fontSize: 13, fontStyle: 'italic' },
  memberList: { gap: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberDot: { width: 10, height: 10, borderRadius: 5 },
  hostDot: { backgroundColor: COLORS.green },
  riderDot: { backgroundColor: COLORS.blue },
  memberName: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '700' },
  hostBadge: {
    color: COLORS.green,
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: '#0F2918',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },

  startBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15, letterSpacing: 0.3 },

  waitingBanner: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  waitingText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },

  hint: { color: COLORS.muted, fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
});
