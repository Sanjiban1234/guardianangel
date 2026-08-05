import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RideSummaryScreen, {
  MOCK_FULL_RIDE_SUMMARY,
} from './src/ui/RideSummaryScreen';
import RiderProfileScreen, {
  INITIAL_PROFILE_DATA,
  RiderProfileData,
} from './src/ui/RiderProfileScreen';

type Screen = 'login' | 'portal' | 'map' | 'countdown' | 'sos' | 'summary' | 'profile';
type Connection = 'live' | 'offline';
type BreakdownReason = 'flat_tire' | 'mechanical_failure' | 'fuel' | 'other';

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
  warningBg: '#2B2008',
  darkInput: '#0F1A12',
};

const REASON_LABELS: Record<BreakdownReason, string> = {
  flat_tire: '🛞 Flat Tire',
  mechanical_failure: '⚙️ Mechanical Failure',
  fuel: '⛽ Fuel / Empty Tank',
  other: '⚠️ Other Mechanical Issue',
};

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [connection, setConnection] = useState<Connection>('live');
  const [seconds, setSeconds] = useState(15);

  // Profile data state
  const [profile, setProfile] = useState<RiderProfileData>(INITIAL_PROFILE_DATA);

  // Breakdown state
  const [breakdownActive, setBreakdownActive] = useState<boolean>(false);
  const [breakdownReason, setBreakdownReason] = useState<BreakdownReason>('flat_tire');
  const [breakdownNote, setBreakdownNote] = useState<string>('Rear tire punctured on gravel segment.');
  const [breakdownRiderName, setBreakdownRiderName] = useState<string>('Jordan Lee');
  const [showReasonModal, setShowReasonModal] = useState<boolean>(false);

  // Group separation state
  const [separationActive, setSeparationActive] = useState<boolean>(false);
  const [separationRole, setSeparationRole] = useState<'rider' | 'group'>('rider');

  useEffect(() => {
    if (screen !== 'countdown') return;
    if (seconds === 0) {
      setScreen('sos');
      return;
    }
    const timer = setTimeout(() => setSeconds(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [screen, seconds]);

  const beginCrashCountdown = () => {
    setSeconds(15);
    setScreen('countdown');
  };

  const triggerBreakdownReport = (reason: BreakdownReason, note: string) => {
    setBreakdownReason(reason);
    setBreakdownNote(note);
    setBreakdownRiderName('Alex Vance (You)');
    setBreakdownActive(true);
    setShowReasonModal(false);
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.ink} />
      {screen === 'login' && <Login onContinue={() => setScreen('portal')} />}

      {screen === 'portal' && (
        <Portal
          connection={connection}
          profile={profile}
          onStart={() => setScreen('map')}
          onOpenProfile={() => setScreen('profile')}
        />
      )}

      {screen === 'profile' && (
        <RiderProfileScreen
          initialData={profile}
          onSave={data => {
            setProfile(data);
            setScreen('portal');
          }}
          onCancel={() => setScreen('portal')}
        />
      )}

      {screen === 'map' && (
        <LiveMap
          connection={connection}
          profile={profile}
          breakdownActive={breakdownActive}
          breakdownReason={breakdownReason}
          breakdownNote={breakdownNote}
          breakdownRiderName={breakdownRiderName}
          separationActive={separationActive}
          separationRole={separationRole}
          onToggleConnection={() => setConnection(v => (v === 'live' ? 'offline' : 'live'))}
          onCrash={beginCrashCountdown}
          onEnd={() => setScreen('summary')}
          onOpenProfile={() => setScreen('profile')}
          onOpenBreakdownModal={() => setShowReasonModal(true)}
          onResolveBreakdown={() => setBreakdownActive(false)}
          onToggleSeparation={() => setSeparationActive(v => !v)}
          onToggleSeparationRole={() => setSeparationRole(r => (r === 'rider' ? 'group' : 'rider'))}
          onSimulateOtherBreakdown={() => {
            setBreakdownRiderName('Sam Miller');
            setBreakdownReason('mechanical_failure');
            setBreakdownNote('Chain snapped on hill incline.');
            setBreakdownActive(true);
          }}
        />
      )}

      {screen === 'countdown' && (
        <CrashCountdown seconds={seconds} onCancel={() => setScreen('map')} />
      )}

      {screen === 'sos' && (
        <SosConfirmation
          profile={profile}
          onReturn={() => setScreen('map')}
          onEnd={() => setScreen('summary')}
        />
      )}

      {screen === 'summary' && (
        <RideSummaryScreen
          data={MOCK_FULL_RIDE_SUMMARY}
          onReturnToPortal={() => setScreen('portal')}
          onExportGpx={() =>
            Alert.alert('GPX export', 'Track export will be available when the ride file service is connected.')
          }
        />
      )}

      {/* REASON SELECTION MODAL POST-TRIGGER */}
      <BreakdownReasonModal
        visible={showReasonModal}
        onClose={() => setShowReasonModal(false)}
        onSubmit={triggerBreakdownReport}
      />
    </SafeAreaProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.shell}>{children}</SafeAreaView>;
}

function Button({
  label,
  onPress,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger' | 'warning';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.button,
        tone === 'secondary' && styles.secondaryButton,
        tone === 'danger' && styles.dangerButton,
        tone === 'warning' && styles.warningButton,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          tone === 'secondary' && styles.secondaryButtonText,
          tone === 'warning' && styles.warningButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Login({ onContinue }: { onContinue: () => void }) {
  const [name, setName] = useState('Alex Vance');
  const [password, setPassword] = useState('guardian1');
  return (
    <Shell>
      <View style={styles.loginContent}>
        <View style={styles.shield}>
          <Text style={styles.shieldText}>GA</Text>
        </View>
        <Text style={styles.brand}>Guardian Angel</Text>
        <Text style={styles.lead}>Sign in to keep your ride group close.</Text>
        <Text style={styles.fieldLabel}>NAME</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor="#5C7062"
          style={styles.input}
          autoCapitalize="words"
        />
        <Text style={styles.fieldLabel}>PASSWORD</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#5C7062"
          style={styles.input}
          secureTextEntry
        />
        <Button label="Sign in" onPress={onContinue} />
        <Text style={styles.helper}>JWT sign-in uses your name and password. No social accounts required.</Text>
      </View>
    </Shell>
  );
}

function Portal({
  connection,
  profile,
  onStart,
  onOpenProfile,
}: {
  connection: Connection;
  profile: RiderProfileData;
  onStart: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.portalHeaderRow}>
          <View>
            <Text style={styles.eyebrow}>WELCOME BACK, ALEX</Text>
            <Text style={styles.title}>Ready for the next ride?</Text>
          </View>
          <Pressable onPress={onOpenProfile} style={styles.profileBadgeBtn}>
            <Text style={styles.profileBadgeBtnText}>⚙️ Settings</Text>
          </Pressable>
        </View>

        <ConnectionBanner connection={connection} />

        {/* PROFILE SUMMARY CARD */}
        <Pressable onPress={onOpenProfile} style={styles.profileSummaryCard}>
          <View style={styles.profileSummaryHeader}>
            <Text style={styles.cardTitle}>👤 Rider Profile & Medical ID</Text>
            <Text style={styles.profileEditLink}>Edit →</Text>
          </View>
          <Text style={styles.profileSummaryMeta}>
            🏍️ {profile.vehicleModel || 'No vehicle set'} ({profile.plateNumber || 'No plate'})
          </Text>
          <View style={styles.medicalPillRow}>
            <View style={styles.medicalPill}>
              <Text style={styles.medicalPillText}>
                🩸 Blood: {profile.bloodGroup !== 'Skip / Unknown' ? profile.bloodGroup : 'Not set'}
              </Text>
            </View>
            {profile.allergies ? (
              <View style={styles.medicalPill}>
                <Text style={styles.medicalPillText}>⚠️ Allergies listed</Text>
              </View>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Start a group ride</Text>
          <Text style={styles.copy}>Create a room and share its group code with your riders.</Text>
          <Button label="Create ride room" onPress={onStart} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Join a group ride</Text>
          <TextInput
            placeholder="Enter group code"
            placeholderTextColor="#5C7062"
            style={styles.input}
            autoCapitalize="characters"
          />
          <Button label="Join with group code" tone="secondary" onPress={onStart} />
        </View>

        <Pressable onPress={() => Alert.alert('Past rides', 'Ride history will appear here when browsing is added.')}>
          <Text style={styles.link}>View past ride summaries</Text>
        </Pressable>
      </ScrollView>
    </Shell>
  );
}

function ConnectionBanner({ connection }: { connection: Connection }) {
  const online = connection === 'live';
  return (
    <View style={[styles.connection, { borderColor: online ? COLORS.green : COLORS.amber }]}>
      <View style={[styles.dot, { backgroundColor: online ? COLORS.green : COLORS.amber }]} />
      <View style={styles.connectionText}>
        <Text style={styles.connectionTitle}>
          {online ? 'LIVE — group can see your position' : 'OFFLINE — using local cache'}
        </Text>
        <Text style={styles.connectionDetail}>
          {online ? 'Location updates are shared now.' : 'Updates will re-sync when connected.'}
        </Text>
      </View>
    </View>
  );
}

function LiveMap({
  connection,
  profile,
  breakdownActive,
  breakdownReason,
  breakdownNote,
  breakdownRiderName,
  separationActive,
  separationRole,
  onToggleConnection,
  onCrash,
  onEnd,
  onOpenProfile,
  onOpenBreakdownModal,
  onResolveBreakdown,
  onToggleSeparation,
  onToggleSeparationRole,
  onSimulateOtherBreakdown,
}: {
  connection: Connection;
  profile: RiderProfileData;
  breakdownActive: boolean;
  breakdownReason: BreakdownReason;
  breakdownNote: string;
  breakdownRiderName: string;
  separationActive: boolean;
  separationRole: 'rider' | 'group';
  onToggleConnection: () => void;
  onCrash: () => void;
  onEnd: () => void;
  onOpenProfile: () => void;
  onOpenBreakdownModal: () => void;
  onResolveBreakdown: () => void;
  onToggleSeparation: () => void;
  onToggleSeparationRole: () => void;
  onSimulateOtherBreakdown: () => void;
}) {
  const [showMedicalSnapshot, setShowMedicalSnapshot] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);

  // Press-and-hold trigger handler
  const handleHoldStart = () => {
    let current = 0;
    const interval = setInterval(() => {
      current += 0.25;
      setHoldProgress(current);
      if (current >= 1) {
        clearInterval(interval);
        setHoldProgress(0);
        onOpenBreakdownModal();
      }
    }, 100);
  };

  const handleHoldEnd = () => {
    setHoldProgress(0);
  };

  // Suppression logic: Breakdown suppresses generic separation alert for that rider
  const showSeparationBanner = separationActive && !breakdownActive;

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.mapPage}>
        {/* HEADER */}
        <View style={styles.mapHeader}>
          <View>
            <Text style={styles.eyebrow}>GROUP CODE GA-8821</Text>
            <Text style={styles.mapTitle}>Saturday Valley Loop</Text>
          </View>
          <View style={styles.headerRightActions}>
            <Pressable onPress={onOpenProfile} style={styles.headerProfileBtn}>
              <Text style={styles.headerProfileBtnText}>⚙️ Profile</Text>
            </Pressable>
            <Pressable onPress={onEnd}>
              <Text style={styles.endRide}>End ride</Text>
            </Pressable>
          </View>
        </View>

        <ConnectionBanner connection={connection} />

        {/* STACKED ALERT VISUAL HIERARCHY */}

        {/* 1. VEHICLE BREAKDOWN ALERT BANNER (#F59E0B - TIER 2 WARNING) */}
        {breakdownActive && (
          <View style={styles.breakdownBanner}>
            <View style={styles.breakdownHeaderRow}>
              <View style={styles.breakdownTitleGroup}>
                <View style={styles.breakdownBadge}>
                  <Text style={styles.breakdownBadgeText}>⚠️ VEHICLE BREAKDOWN</Text>
                </View>
                <Text style={styles.breakdownRiderTitle}>
                  {breakdownRiderName}&apos;s {profile.vehicleModel || 'Motorcycle'}
                </Text>
              </View>
              <Pressable onPress={onResolveBreakdown} style={styles.resolveBtn}>
                <Text style={styles.resolveBtnText}>Clear / Rejoined</Text>
              </Pressable>
            </View>

            <View style={styles.breakdownDetailRow}>
              <Text style={styles.breakdownDetailTag}>
                REASON: {REASON_LABELS[breakdownReason]}
              </Text>
              <Text style={styles.breakdownDetailMeta}>
                Plate: {profile.plateNumber || 'BA 2 PA 1234'} · Color: {profile.vehicleColor || 'Black'}
              </Text>
            </View>

            {breakdownNote ? (
              <Text style={styles.breakdownNoteText}>&quot;{breakdownNote}&quot;</Text>
            ) : null}

            {/* PRIVACY-GATED MEDICAL ID SNAPSHOT (IF PRESENT) */}
            {profile.bloodGroup || profile.emergencyContact ? (
              <View style={styles.medicalSnapshotBox}>
                <Pressable
                  onPress={() => setShowMedicalSnapshot(v => !v)}
                  style={styles.medicalSnapshotToggle}
                >
                  <Text style={styles.medicalSnapshotToggleText}>
                    🩸 Emergency Medical ID Snapshot {showMedicalSnapshot ? '▲ Hide' : '▼ View'}
                  </Text>
                  <Text style={styles.medicalPrivacyLabel}>Gated Snapshot</Text>
                </Pressable>

                {showMedicalSnapshot && (
                  <View style={styles.medicalSnapshotBody}>
                    <Text style={styles.medicalSnapshotItem}>
                      <Text style={styles.boldText}>Blood Group:</Text> {profile.bloodGroup}
                    </Text>
                    <Text style={styles.medicalSnapshotItem}>
                      <Text style={styles.boldText}>Allergies:</Text> {profile.allergies || 'None reported'}
                    </Text>
                    <Text style={styles.medicalSnapshotItem}>
                      <Text style={styles.boldText}>Emergency Contact:</Text> {profile.emergencyContact || 'None listed'}
                    </Text>
                    {profile.medicalNotes ? (
                      <Text style={styles.medicalSnapshotItem}>
                        <Text style={styles.boldText}>Notes:</Text> {profile.medicalNotes}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}
          </View>
        )}

        {/* 2. GROUP SEPARATION ALERT BANNER (#F59E0B - TIER 3 INFORMATIONAL) */}
        {showSeparationBanner && (
          <View style={styles.separationBanner}>
            <View style={styles.separationHeaderRow}>
              <View style={styles.separationBadge}>
                <Text style={styles.separationBadgeText}>📍 GROUP SEPARATION (&gt;500m)</Text>
              </View>
              <Text style={styles.separationAutoClearText}>Auto-clears on reunite</Text>
            </View>

            {separationRole === 'rider' ? (
              <View style={styles.separationRoleBlock}>
                <Text style={styles.separationMainTitle}>
                  You are lagging behind the main group.
                </Text>
                <View style={styles.speedGuidancePill}>
                  <Text style={styles.speedGuidancePillText}>
                    ⚡ SUGGESTED TARGET SPEED: 45–55 km/h (Capped Catch-up)
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.separationRoleBlock}>
                <Text style={styles.separationMainTitle}>
                  Rider Jordan Lee separated from group.
                </Text>
                <View style={[styles.speedGuidancePill, styles.slowDownPill]}>
                  <Text style={[styles.speedGuidancePillText, styles.slowDownPillText]}>
                    🐢 SUGGESTED TARGET SPEED: 30–40 km/h (Capped Slow Down)
                  </Text>
                </View>
              </View>
            )}

            <Text style={styles.midpointNotice}>
              📍 Meeting Area: Approximate straight-line midpoint ahead (KM 14.2)
            </Text>
          </View>
        )}

        {/* MAP CANVAS */}
        <View style={styles.mapCanvas}>
          <Text style={styles.mapRoad}>VALLEY HIGHWAY (N-2)</Text>
          <View style={styles.routeOne} />
          <View style={styles.routeTwo} />

          <Marker label="YOU" style={styles.youMarker} />
          <Marker label="M" style={styles.markerOne} />
          <Marker label="J" style={styles.markerTwo} />

          {/* APPROXIMATE MIDPOINT MARKER (WHEN SEPARATION ACTIVE) */}
          {separationActive && (
            <View style={styles.approxMidpointMarker}>
              <View style={styles.approxMidpointCircle} />
              <Text style={styles.approxMidpointText}>APPROXIMATE MEETING AREA</Text>
            </View>
          )}

          {/* BREAKDOWN PIN MARKER */}
          {breakdownActive && (
            <View style={styles.breakdownMapPin}>
              <Text style={styles.breakdownMapPinText}>⚠️ REPAIR</Text>
            </View>
          )}

          <View style={styles.weatherSlot}>
            <Text style={styles.weatherLabel}>WEATHER SPACE</Text>
            <Text style={styles.weatherCopy}>24°C · Mild Breeze</Text>
          </View>
        </View>

        {/* AMBIENT GROUP MEMBER ROSTER WITH VEHICLE INFO */}
        <View style={styles.memberCard}>
          <View style={styles.memberRowHeader}>
            <Text style={styles.cardTitle}>Ride Group Roster (4 Riders)</Text>
            <Text style={styles.memberCountText}>3 Live GPS</Text>
          </View>

          <View style={styles.rosterList}>
            <View style={styles.rosterItem}>
              <View style={[styles.rosterDot, { backgroundColor: COLORS.green }]} />
              <View style={styles.rosterTextCol}>
                <Text style={styles.rosterNameText}>Alex Vance (You)</Text>
                <Text style={styles.rosterVehicleText}>
                  {profile.vehicleModel} · {profile.plateNumber}
                </Text>
              </View>
              <Text style={styles.rosterRoleBadge}>Lead</Text>
            </View>

            <View style={styles.rosterItem}>
              <View
                style={[
                  styles.rosterDot,
                  { backgroundColor: breakdownActive ? COLORS.amber : COLORS.green },
                ]}
              />
              <View style={styles.rosterTextCol}>
                <Text style={styles.rosterNameText}>Jordan Lee</Text>
                <Text style={styles.rosterVehicleText}>
                  KTM Duke 390 · BA 1 PA 9901
                  {breakdownActive ? ' (BREAKDOWN)' : ''}
                </Text>
              </View>
              {breakdownActive && <Text style={styles.breakdownTagSmall}>Stopped</Text>}
            </View>

            <View style={styles.rosterItem}>
              <View style={[styles.rosterDot, { backgroundColor: COLORS.green }]} />
              <View style={styles.rosterTextCol}>
                <Text style={styles.rosterNameText}>Maya Lin</Text>
                <Text style={styles.rosterVehicleText}>Yamaha MT-07 · BA 4 PA 4410</Text>
              </View>
            </View>

            <View style={styles.rosterItem}>
              <View style={[styles.rosterDot, { backgroundColor: COLORS.muted }]} />
              <View style={styles.rosterTextCol}>
                <Text style={styles.rosterNameText}>Sam Miller</Text>
                <Text style={styles.rosterVehicleText}>Royal Enfield Interceptor 650</Text>
              </View>
              <Text style={styles.rosterOfflineText}>Cached</Text>
            </View>
          </View>
        </View>

        {/* MAP CONTROLS & TRIGGERS */}
        <View style={styles.controlsSection}>
          <Text style={styles.fieldLabel}>RIDE & SAFETY CONTROLS</Text>

          {/* DELIBERATE BREAKDOWN TRIGGER (PRESS & HOLD OR TAP) */}
          <Pressable
            onPressIn={handleHoldStart}
            onPressOut={handleHoldEnd}
            onPress={onOpenBreakdownModal}
            style={styles.breakdownTriggerBtn}
          >
            <View
              style={[
                styles.holdProgressBar,
                { width: `${Math.min(100, holdProgress * 100)}%` },
              ]}
            />
            <Text style={styles.breakdownTriggerBtnText}>
              ⚠️ Report Vehicle Breakdown (Press & Hold)
            </Text>
          </Pressable>

          <Button
            label={connection === 'live' ? 'Preview offline state' : 'Reconnect and sync'}
            tone="secondary"
            onPress={onToggleConnection}
          />
          <Button
            label="Manual traffic override"
            tone="secondary"
            onPress={() =>
              Alert.alert(
                'Traffic override',
                'This deliberate control would send a route hazard to your group.',
              )
            }
          />
        </View>

        {/* DEMO / TEST STATE TOGGLES */}
        <View style={styles.demoControlsBox}>
          <Text style={styles.demoBoxTitle}>TEST DEMO CONTROLS</Text>
          <View style={styles.demoBtnGrid}>
            <Pressable onPress={onToggleSeparation} style={styles.demoMiniBtn}>
              <Text style={styles.demoMiniBtnText}>
                {separationActive ? 'Clear Separation' : 'Trigger Separation'}
              </Text>
            </Pressable>

            {separationActive && (
              <Pressable onPress={onToggleSeparationRole} style={styles.demoMiniBtn}>
                <Text style={styles.demoMiniBtnText}>
                  Role: {separationRole === 'rider' ? 'Separated Rider' : 'Main Group'}
                </Text>
              </Pressable>
            )}

            <Pressable onPress={onSimulateOtherBreakdown} style={styles.demoMiniBtn}>
              <Text style={styles.demoMiniBtnText}>Simulate Sam Breakdown</Text>
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" onPress={onCrash} style={styles.demoCrash}>
            <Text style={styles.demoCrashText}>Demo: simulate crash detection SOS</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Shell>
  );
}

function BreakdownReasonModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: BreakdownReason, note: string) => void;
}) {
  const [selectedReason, setSelectedReason] = useState<BreakdownReason>('flat_tire');
  const [note, setNote] = useState('');

  const handleConfirm = () => {
    onSubmit(selectedReason, note);
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.eyebrow}>VEHICLE BREAKDOWN REPORT</Text>
          <Text style={styles.modalTitle}>Report issue to ride group</Text>
          <Text style={styles.modalCopy}>
            This alerts all riders in your group and suppresses generic separation warnings.
          </Text>

          <Text style={styles.fieldLabel}>SELECT REASON</Text>
          <View style={styles.reasonOptionList}>
            {(['flat_tire', 'mechanical_failure', 'fuel', 'other'] as BreakdownReason[]).map(r => (
              <Pressable
                key={r}
                onPress={() => setSelectedReason(r)}
                style={[
                  styles.reasonOptionBtn,
                  selectedReason === r && styles.reasonOptionBtnSelected,
                ]}
              >
                <Text
                  style={[
                    styles.reasonOptionText,
                    selectedReason === r && styles.reasonOptionTextSelected,
                  ]}
                >
                  {REASON_LABELS[r]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>OPTIONAL NOTE FOR RIDERS</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Pulled over near KM 18 marker."
            placeholderTextColor="#5C7062"
            style={styles.input}
          />

          <View style={styles.modalActionRow}>
            <Pressable onPress={handleConfirm} style={styles.confirmBreakdownBtn}>
              <Text style={styles.confirmBreakdownBtnText}>Broadcast Breakdown Alert</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.cancelBreakdownBtn}>
              <Text style={styles.cancelBreakdownBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Marker({ label, style }: { label: string; style: object }) {
  return (
    <View style={[styles.marker, style]}>
      <Text style={styles.markerText}>{label}</Text>
    </View>
  );
}

function CrashCountdown({ seconds, onCancel }: { seconds: number; onCancel: () => void }) {
  return (
    <Shell>
      <View style={styles.emergencyPage}>
        <Text style={styles.eyebrow}>SAFETY CHECK</Text>
        <Text style={styles.emergencyTitle}>We detected a possible crash.</Text>
        <Text style={styles.emergencyCopy}>
          An SOS alert will be sent to your ride group unless you cancel.
        </Text>
        <View style={styles.countdownCircle}>
          <Text style={styles.countdownNumber}>{seconds}</Text>
          <Text style={styles.countdownLabel}>SECONDS</Text>
        </View>
        <Button label="I'M OK — CANCEL ALERT" tone="secondary" onPress={onCancel} />
        <Text style={styles.cancelHint}>Large cancel control · no precision needed</Text>
      </View>
    </Shell>
  );
}

function SosConfirmation({
  profile,
  onReturn,
  onEnd,
}: {
  profile: RiderProfileData;
  onReturn: () => void;
  onEnd: () => void;
}) {
  const hasMedical = profile.bloodGroup !== 'Skip / Unknown' || profile.allergies || profile.emergencyContact;

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.emergencyPage}>
        <View style={styles.sosIcon}>
          <Text style={styles.sosIconText}>!</Text>
        </View>
        <Text style={styles.eyebrow}>SOS SENT</Text>
        <Text style={styles.emergencyTitle}>Help is being notified.</Text>
        <Text style={styles.emergencyCopy}>
          Your ride group and listed guardians received your last known location. Stay where you are if it is safe.
        </Text>

        <View style={styles.notifiedCard}>
          <Text style={styles.cardTitle}>Alert recipients</Text>
          <Text style={styles.copy}>Maya, Jordan, Sam and 2 guardians</Text>
          <Text style={styles.sentAt}>Sent now · live location attached</Text>
        </View>

        {/* PRIVACY-GATED MEDICAL ID SNAPSHOT (SHOWN ONLY IF PRESENT) */}
        {hasMedical ? (
          <View style={styles.sosMedicalCard}>
            <View style={styles.sosMedicalHeader}>
              <Text style={styles.sosMedicalTitle}>🩸 Attached Medical ID Snapshot</Text>
              <Text style={styles.sosMedicalBadge}>Gated Payload</Text>
            </View>
            <View style={styles.sosMedicalGrid}>
              <Text style={styles.sosMedicalText}>
                <Text style={styles.boldText}>Blood Group:</Text> {profile.bloodGroup}
              </Text>
              <Text style={styles.sosMedicalText}>
                <Text style={styles.boldText}>Allergies:</Text> {profile.allergies || 'None listed'}
              </Text>
              <Text style={styles.sosMedicalText}>
                <Text style={styles.boldText}>Emergency Contact:</Text> {profile.emergencyContact || 'None listed'}
              </Text>
              <Text style={styles.sosMedicalText}>
                <Text style={styles.boldText}>Vehicle:</Text> {profile.vehicleModel} ({profile.plateNumber})
              </Text>
            </View>
          </View>
        ) : null}

        <Button label="Return to live map" onPress={onReturn} />
        <Button label="End ride and view summary" tone="secondary" onPress={onEnd} />
      </ScrollView>
    </Shell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink },
  page: { padding: 24, gap: 16 },
  loginContent: { flex: 1, padding: 28, justifyContent: 'center', gap: 12 },
  shield: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: COLORS.forest,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  shieldText: { color: COLORS.text, fontWeight: '900', fontSize: 20 },
  brand: { color: COLORS.text, fontSize: 31, fontWeight: '800' },
  lead: { color: COLORS.muted, fontSize: 16, marginBottom: 22 },
  eyebrow: { color: '#86EFAC', fontWeight: '800', fontSize: 11, letterSpacing: 1.1 },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', marginBottom: 6 },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 6 },
  input: {
    backgroundColor: '#0F1A12',
    borderColor: COLORS.line,
    borderWidth: 1,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    fontSize: 15,
  },
  button: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { color: COLORS.ink, fontWeight: '900', fontSize: 14, letterSpacing: 0.2 },
  secondaryButton: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line },
  secondaryButtonText: { color: COLORS.text },
  dangerButton: { backgroundColor: COLORS.red },
  warningButton: { backgroundColor: COLORS.amber },
  warningButtonText: { color: COLORS.ink },
  helper: { color: '#5C7062', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 8 },
  card: {
    backgroundColor: COLORS.card,
    padding: 18,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    gap: 10,
  },
  cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  copy: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  link: { color: '#60A5FA', fontWeight: '700', textAlign: 'center', marginTop: 4 },
  connection: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  connectionText: { flex: 1 },
  connectionTitle: { color: COLORS.text, fontWeight: '800', fontSize: 12 },
  connectionDetail: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  portalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  profileBadgeBtn: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  profileBadgeBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  profileSummaryCard: {
    backgroundColor: '#0E1D13',
    borderColor: '#23442D',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  profileSummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileEditLink: { color: '#60A5FA', fontWeight: '700', fontSize: 12 },
  profileSummaryMeta: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  medicalPillRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  medicalPill: {
    backgroundColor: '#162C1D',
    borderColor: COLORS.line,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  medicalPillText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  mapPage: { padding: 18, gap: 12 },
  mapHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerRightActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerProfileBtn: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  headerProfileBtnText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  mapTitle: { color: COLORS.text, fontSize: 21, fontWeight: '800' },
  endRide: { color: '#FCA5A5', fontWeight: '800', fontSize: 13 },
  breakdownBanner: {
    backgroundColor: COLORS.warningBg,
    borderColor: COLORS.amber,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  breakdownHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  breakdownTitleGroup: { flex: 1, gap: 2 },
  breakdownBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.amber,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  breakdownBadgeText: { color: COLORS.ink, fontWeight: '900', fontSize: 10 },
  breakdownRiderTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginTop: 2 },
  resolveBtn: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.amber,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  resolveBtnText: { color: COLORS.amber, fontWeight: '800', fontSize: 11 },
  breakdownDetailRow: { gap: 2 },
  breakdownDetailTag: { color: COLORS.amber, fontWeight: '800', fontSize: 12 },
  breakdownDetailMeta: { color: COLORS.muted, fontSize: 12 },
  breakdownNoteText: { color: COLORS.text, fontStyle: 'italic', fontSize: 12, backgroundColor: '#1A1406', padding: 8, borderRadius: 6 },
  medicalSnapshotBox: {
    backgroundColor: '#1E1708',
    borderColor: '#42320E',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  medicalSnapshotToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  medicalSnapshotToggleText: { color: COLORS.amber, fontWeight: '700', fontSize: 12 },
  medicalPrivacyLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '800' },
  medicalSnapshotBody: { marginTop: 8, gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#36290C' },
  medicalSnapshotItem: { color: COLORS.text, fontSize: 12 },
  boldText: { fontWeight: '800', color: COLORS.muted },
  separationBanner: {
    backgroundColor: '#261F0A',
    borderColor: COLORS.amber,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  separationHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  separationBadge: { backgroundColor: '#42330A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  separationBadgeText: { color: COLORS.amber, fontWeight: '800', fontSize: 10 },
  separationAutoClearText: { color: COLORS.muted, fontSize: 10 },
  separationRoleBlock: { gap: 6 },
  separationMainTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  speedGuidancePill: {
    backgroundColor: COLORS.forest,
    borderColor: '#4ADE80',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  speedGuidancePillText: { color: COLORS.text, fontWeight: '800', fontSize: 11 },
  slowDownPill: { backgroundColor: '#3D2D0C', borderColor: COLORS.amber },
  slowDownPillText: { color: COLORS.amber },
  midpointNotice: { color: COLORS.muted, fontSize: 11, fontStyle: 'italic' },
  mapCanvas: {
    height: 280,
    backgroundColor: '#183327',
    borderRadius: 18,
    borderColor: '#28523B',
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  mapRoad: {
    color: '#73947F',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    position: 'absolute',
    top: 46,
    left: 100,
  },
  routeOne: {
    height: 9,
    width: 340,
    borderRadius: 10,
    backgroundColor: COLORS.blue,
    transform: [{ rotate: '-24deg' }],
    position: 'absolute',
    top: 130,
    left: -25,
  },
  routeTwo: {
    height: 9,
    width: 280,
    borderRadius: 10,
    backgroundColor: COLORS.blue,
    transform: [{ rotate: '38deg' }],
    position: 'absolute',
    top: 150,
    right: -40,
  },
  marker: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.blue,
    borderWidth: 3,
    borderColor: '#DCEBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  youMarker: { top: 115, left: '45%', backgroundColor: COLORS.forest },
  markerOne: { top: 75, left: '25%' },
  markerTwo: { top: 195, left: '18%' },
  markerText: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  approxMidpointMarker: {
    position: 'absolute',
    top: 155,
    left: '52%',
    alignItems: 'center',
  },
  approxMidpointCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: COLORS.amber,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  approxMidpointText: { color: COLORS.amber, fontSize: 8, fontWeight: '900', marginTop: 2, textAlign: 'center' },
  breakdownMapPin: {
    position: 'absolute',
    top: 70,
    left: '22%',
    backgroundColor: COLORS.amber,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  breakdownMapPinText: { color: COLORS.ink, fontWeight: '900', fontSize: 9 },
  weatherSlot: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#102015',
    borderColor: COLORS.line,
    borderWidth: 1,
    padding: 8,
    borderRadius: 10,
  },
  weatherLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '800' },
  weatherCopy: { color: COLORS.text, fontSize: 10, fontWeight: '600', marginTop: 2 },
  memberCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  memberRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memberCountText: { color: COLORS.muted, fontSize: 12 },
  rosterList: { gap: 10 },
  rosterItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rosterDot: { width: 10, height: 10, borderRadius: 5 },
  rosterTextCol: { flex: 1 },
  rosterNameText: { color: COLORS.text, fontWeight: '700', fontSize: 13 },
  rosterVehicleText: { color: COLORS.muted, fontSize: 11, marginTop: 1 },
  rosterRoleBadge: { color: '#86EFAC', fontWeight: '800', fontSize: 10 },
  rosterOfflineText: { color: COLORS.muted, fontSize: 10 },
  breakdownTagSmall: { color: COLORS.amber, fontWeight: '800', fontSize: 10 },
  controlsSection: { gap: 8 },
  breakdownTriggerBtn: {
    backgroundColor: COLORS.warningBg,
    borderColor: COLORS.amber,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  holdProgressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(245, 158, 11, 0.35)',
  },
  breakdownTriggerBtnText: { color: COLORS.amber, fontWeight: '900', fontSize: 13 },
  demoControlsBox: {
    backgroundColor: '#0F1812',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    marginTop: 8,
  },
  demoBoxTitle: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  demoBtnGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoMiniBtn: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  demoMiniBtnText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  demoCrash: { alignItems: 'center', padding: 8, marginTop: 4 },
  demoCrashText: { color: '#FCA5A5', fontWeight: '700', fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 22,
    gap: 12,
  },
  modalTitle: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  modalCopy: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  reasonOptionList: { gap: 8, marginVertical: 4 },
  reasonOptionBtn: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  reasonOptionBtnSelected: {
    backgroundColor: '#33260A',
    borderColor: COLORS.amber,
  },
  reasonOptionText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },
  reasonOptionTextSelected: { color: COLORS.amber, fontWeight: '800' },
  modalActionRow: { gap: 10, marginTop: 8 },
  confirmBreakdownBtn: {
    backgroundColor: COLORS.amber,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBreakdownBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 14 },
  cancelBreakdownBtn: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBreakdownBtnText: { color: COLORS.muted, fontWeight: '700', fontSize: 14 },
  emergencyPage: { padding: 28, alignItems: 'center', justifyContent: 'center', gap: 18 },
  emergencyTitle: { color: COLORS.text, fontSize: 29, fontWeight: '900', textAlign: 'center', lineHeight: 35 },
  emergencyCopy: { color: COLORS.muted, textAlign: 'center', lineHeight: 22, fontSize: 15 },
  countdownCircle: {
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 9,
    borderColor: COLORS.red,
    backgroundColor: '#311214',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
  },
  countdownNumber: { color: '#FCA5A5', fontSize: 68, fontWeight: '900' },
  countdownLabel: { color: '#FCA5A5', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  cancelHint: { color: COLORS.muted, fontSize: 12 },
  sosIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#4A1215',
    borderWidth: 2,
    borderColor: COLORS.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosIconText: { color: '#FCA5A5', fontSize: 40, fontWeight: '900' },
  notifiedCard: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 7,
  },
  sentAt: { color: '#86EFAC', fontSize: 12, fontWeight: '700' },
  sosMedicalCard: {
    alignSelf: 'stretch',
    backgroundColor: '#261214',
    borderColor: COLORS.red,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  sosMedicalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sosMedicalTitle: { color: '#FCA5A5', fontWeight: '800', fontSize: 14 },
  sosMedicalBadge: { color: '#FCA5A5', fontSize: 9, fontWeight: '800', backgroundColor: '#4D1B1E', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  sosMedicalGrid: { gap: 4 },
  sosMedicalText: { color: COLORS.text, fontSize: 12 },
});

export default App;
