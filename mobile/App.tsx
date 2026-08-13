import React, { useEffect, useRef, useState } from 'react';
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
import CreateRideDestinationScreen, {
  CreatedRoomData,
} from './src/ui/CreateRideDestinationScreen';
import JoinRideScreen, { RoomPreviewDetails } from './src/ui/JoinRideScreen';
import RefuelNotificationModal, {
  RefuelAlertPayload,
} from './src/ui/RefuelNotificationModal';
import RegistrationGateScreen, {
  RegistrationData,
} from './src/ui/RegistrationGateScreen';
import RideSummaryScreen, {
  MOCK_FULL_RIDE_SUMMARY,
} from './src/ui/RideSummaryScreen';
import RiderProfileScreen, {
  INITIAL_PROFILE_DATA,
  RiderProfileData,
} from './src/ui/RiderProfileScreen';
import { SocketClient } from './src/telemetry/socket/SocketClient';
import { useCrashDetection } from './src/safety/crash/useCrashDetection';
import { useCountdown } from './src/safety/countdown/useCountdown';

type Screen =
  | 'login'
  | 'registration'
  | 'portal'
  | 'create_destination'
  | 'join'
  | 'map'
  | 'countdown'
  | 'sos'
  | 'summary'
  | 'profile';

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

// Configure this per deployment; Android emulator callers normally use 10.0.2.2.
const API_BASE_URL = 'http://10.0.2.2:3000';

type DeviceGeolocation = {
  getCurrentPosition: (
    success: (position: { coords: { latitude: number; longitude: number } }) => void,
    failure: () => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ) => void;
};

function readCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
  const geolocation = (globalThis as unknown as { navigator?: { geolocation?: DeviceGeolocation } }).navigator?.geolocation;
  if (!geolocation) return Promise.reject(new Error('Device location is unavailable'));
  return new Promise((resolve, reject) => geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    () => reject(new Error('Unable to obtain current location')),
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 10_000 },
  ));
}

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [connection, setConnection] = useState<Connection>('live');
  const [authToken, setAuthToken] = useState('');
  const socketRef = useRef(new SocketClient());
  const lastCrashLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const { lastCandidate } = useCrashDetection({ apiBaseUrl: API_BASE_URL });
  const countdown = useCountdown({ durationMs: 15_000 });

  // Registration gate state
  const [hasCompletedRegistration, setHasCompletedRegistration] = useState(false);
  const [riderName, setRiderName] = useState('Alex Vance');

  // Profile data state
  const [profile, setProfile] = useState<RiderProfileData>(INITIAL_PROFILE_DATA);

  // Room / Destination state
  const [activeRoomCode, setActiveRoomCode] = useState<string>('');
  const [destinationTitle, setDestinationTitle] = useState<string>('Saturday Valley Loop');

  // Refuel alert state
  const [refuelActive, setRefuelActive] = useState<boolean>(false);
  const [refuelRiderName, setRefuelRiderName] = useState<string>('');
  const [refuelNote, setRefuelNote] = useState<string>('');
  const [showRefuelModal, setShowRefuelModal] = useState<boolean>(false);

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
    if (!authToken) return;
    const unsubscribe = socketRef.current.onConnect(() => {
      setConnection('live');
      if (activeRoomCode) socketRef.current.joinSession(activeRoomCode).catch(() => setConnection('offline'));
      socketRef.current.onEvent('refill:notified', (payload) => {
        setRefuelRiderName(payload.name);
        setRefuelNote(payload.note || 'Need petrol stop soon.');
        setRefuelActive(true);
      });
    });
    socketRef.current.connect(API_BASE_URL, authToken).catch(() => setConnection('offline'));
    return () => {
      unsubscribe();
      socketRef.current.disconnect();
    };
  }, [authToken, activeRoomCode]);

  useEffect(() => {
    if (!lastCandidate || !socketRef.current.isConnected()) return;
    readCurrentLocation().then((location) => {
      lastCrashLocationRef.current = location;
      socketRef.current.emitEvent('crash:candidate', {
        timestamp: lastCandidate.detectedAt,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      countdown.start();
      setScreen('countdown');
    }).catch((error) => Alert.alert('Crash location unavailable', error.message));
  }, [lastCandidate]);

  useEffect(() => countdown.onExpire(() => {
    const location = lastCrashLocationRef.current;
    if (location && socketRef.current.isConnected()) {
      socketRef.current.emitEvent('crash:countdownExpired', {
        timestamp: Date.now(), latitude: location.latitude, longitude: location.longitude,
      });
    }
    setScreen('sos');
  }), []);

  const handleLoginContinue = async (name: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Sign in failed');
      setAuthToken(body.token);
      setRiderName(body.user.name);
      setHasCompletedRegistration(body.user.profile_complete !== false);
      setScreen(body.user.profile_complete === false ? 'registration' : 'portal');
    } catch (error) {
      Alert.alert('Sign in failed', error instanceof Error ? error.message : 'Unable to sign in.');
    }
  };

  const handleRegistrationComplete = async (data: RegistrationData) => {
    setHasCompletedRegistration(true);
    setRiderName(data.fullName);
    setProfile(prev => ({
      ...prev,
      vehicleModel: data.vehicleModel,
      plateNumber: data.plateNumber,
      vehicleColor: data.vehicleColor,
      emergencyContact: data.emergencyContact,
    }));
    await handleLoginContinue(data.fullName, data.password);
  };

  const handleCreatedRoomStart = (roomData: CreatedRoomData) => {
    setActiveRoomCode(roomData.groupCode);
    setDestinationTitle(roomData.destination.title);
    setScreen('map');
  };

  const handleJoinedRoomConfirm = (preview: RoomPreviewDetails) => {
    setActiveRoomCode(preview.groupCode);
    setDestinationTitle(preview.destinationTitle);
    setScreen('map');
  };

  const handleSendRefuelAlert = (payload: RefuelAlertPayload) => {
    try {
      socketRef.current.emitEvent('refill:requested', {
        group_code: activeRoomCode,
        note: payload.note || 'Need petrol stop soon.',
      });
      setShowRefuelModal(false);
    } catch (error) {
      Alert.alert('Refill request failed', error instanceof Error ? error.message : 'Reconnect and try again.');
    }
  };

  const cancelCrashCountdown = () => {
    countdown.cancel();
    if (socketRef.current.isConnected()) socketRef.current.emitEvent('crash:cancelled');
    setScreen('map');
  };

  const triggerBreakdownReport = (reason: BreakdownReason, note: string) => {
    setBreakdownReason(reason);
    setBreakdownNote(note);
    setBreakdownRiderName(`${riderName} (You)`);
    setBreakdownActive(true);
    setShowReasonModal(false);
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.ink} />

      {screen === 'login' && (
        <Login onContinue={handleLoginContinue} />
      )}

      {screen === 'registration' && (
        <RegistrationGateScreen
          initialData={{
            fullName: riderName,
            vehicleModel: profile.vehicleModel,
            plateNumber: profile.plateNumber,
            vehicleColor: profile.vehicleColor,
            emergencyContact: profile.emergencyContact,
          }}
          apiBaseUrl={API_BASE_URL}
          isOnline={connection === 'live'}
          onCompleteRegistration={handleRegistrationComplete}
        />
      )}

      {screen === 'portal' && (
        <Portal
          riderName={riderName}
          connection={connection}
          profile={profile}
          onCreateRide={() => setScreen('create_destination')}
          onJoinRide={() => setScreen('join')}
          onOpenProfile={() => setScreen('profile')}
        />
      )}

      {screen === 'create_destination' && (
        <CreateRideDestinationScreen
          creatorName={riderName}
          apiBaseUrl={API_BASE_URL}
          authToken={authToken}
          isOnline={connection === 'live'}
          onCancel={() => setScreen('portal')}
          onConfirmAndStartRide={handleCreatedRoomStart}
        />
      )}

      {screen === 'join' && (
        <JoinRideScreen
          initialCode={activeRoomCode}
          apiBaseUrl={API_BASE_URL}
          authToken={authToken}
          isOnline={connection === 'live'}
          onCancel={() => setScreen('portal')}
          onConfirmJoin={handleJoinedRoomConfirm}
        />
      )}

      {screen === 'profile' && (
        <RiderProfileScreen
          initialData={profile}
          apiBaseUrl={API_BASE_URL}
          authToken={authToken}
          isOnline={connection === 'live'}
          onSave={data => {
            setProfile(data);
            setScreen('portal');
          }}
          onCancel={() => setScreen('portal')}
        />
      )}

      {screen === 'map' && (
        <LiveMap
          roomCode={activeRoomCode}
          destinationTitle={destinationTitle}
          riderName={riderName}
          connection={connection}
          profile={profile}
          refuelActive={refuelActive}
          refuelRiderName={refuelRiderName}
          refuelNote={refuelNote}
          breakdownActive={breakdownActive}
          breakdownReason={breakdownReason}
          breakdownNote={breakdownNote}
          breakdownRiderName={breakdownRiderName}
          separationActive={separationActive}
          separationRole={separationRole}
          onToggleConnection={() => setConnection(v => (v === 'live' ? 'offline' : 'live'))}
          onCrash={() => Alert.alert('Crash monitoring active', 'Crash alerts are started only by the sensor state machine.')}
          onEnd={() => setScreen('summary')}
          onOpenProfile={() => setScreen('profile')}
          onOpenRefuelModal={() => setShowRefuelModal(true)}
          onResolveRefuel={() => setRefuelActive(false)}
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
          onSimulateOtherRefuel={() => {
            setRefuelRiderName('Maya Lin');
            setRefuelNote('Fuel light turned on, looking for gas station.');
            setRefuelActive(true);
          }}
        />
      )}

      {screen === 'countdown' && (
        <CrashCountdown seconds={Math.ceil(countdown.remainingMs / 1000)} onCancel={cancelCrashCountdown} />
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

      {/* MODALS */}
      <RefuelNotificationModal
        visible={showRefuelModal}
        riderName={riderName}
        isOnline={connection === 'live' && socketRef.current.isConnected()}
        onClose={() => setShowRefuelModal(false)}
        onSendRefuelAlert={handleSendRefuelAlert}
      />

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
  tone?: 'primary' | 'secondary' | 'danger' | 'warning' | 'success';
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
        tone === 'success' && styles.successButton,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          tone === 'secondary' && styles.secondaryButtonText,
          tone === 'warning' && styles.warningButtonText,
          tone === 'success' && styles.successButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Login({ onContinue }: { onContinue: (name: string, password: string) => void }) {
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
        <Button label="Sign in →" onPress={() => onContinue(name, password)} />
        <Text style={styles.helper}>JWT sign-in uses your name and password. No social accounts required.</Text>
      </View>
    </Shell>
  );
}

function Portal({
  riderName,
  connection,
  profile,
  onCreateRide,
  onJoinRide,
  onOpenProfile,
}: {
  riderName: string;
  connection: Connection;
  profile: RiderProfileData;
  onCreateRide: () => void;
  onJoinRide: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.portalHeaderRow}>
          <View>
            <Text style={styles.eyebrow}>WELCOME BACK, {riderName.toUpperCase()}</Text>
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

        {/* CREATE RIDE CARD */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Start a group ride</Text>
          <Text style={styles.copy}>Select a destination, generate a room code and share with your riders.</Text>
          <Button label="Create ride room & set destination →" onPress={onCreateRide} />
        </View>

        {/* JOIN RIDE CARD */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Join a group ride</Text>
          <Text style={styles.copy}>Enter a 6-character room code or open a shared invite link.</Text>
          <Button label="Join ride with group code / link →" tone="secondary" onPress={onJoinRide} />
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
  roomCode,
  destinationTitle,
  riderName,
  connection,
  profile,
  refuelActive,
  refuelRiderName,
  refuelNote,
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
  onOpenRefuelModal,
  onResolveRefuel,
  onOpenBreakdownModal,
  onResolveBreakdown,
  onToggleSeparation,
  onToggleSeparationRole,
  onSimulateOtherBreakdown,
  onSimulateOtherRefuel,
}: {
  roomCode: string;
  destinationTitle: string;
  riderName: string;
  connection: Connection;
  profile: RiderProfileData;
  refuelActive: boolean;
  refuelRiderName: string;
  refuelNote: string;
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
  onOpenRefuelModal: () => void;
  onResolveRefuel: () => void;
  onOpenBreakdownModal: () => void;
  onResolveBreakdown: () => void;
  onToggleSeparation: () => void;
  onToggleSeparationRole: () => void;
  onSimulateOtherBreakdown: () => void;
  onSimulateOtherRefuel: () => void;
}) {
  const [showMedicalSnapshot, setShowMedicalSnapshot] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);

  // Press-and-hold trigger handler for breakdown
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

  const showSeparationBanner = separationActive && !breakdownActive;

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.mapPage}>
        {/* HEADER */}
        <View style={styles.mapHeader}>
          <View>
            <Text style={styles.eyebrow}>GROUP CODE {roomCode}</Text>
            <Text style={styles.mapTitle}>{destinationTitle}</Text>
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

        {/* REFUEL NOTIFICATION BANNER (#16A34A - NEUTRAL / LOW URGENCY) */}
        {refuelActive && (
          <View style={styles.refuelBanner}>
            <View style={styles.refuelHeaderRow}>
              <View style={styles.refuelBadge}>
                <Text style={styles.refuelBadgeText}>⛽ REFUEL / PETROL REQUEST</Text>
              </View>
              <Pressable onPress={onResolveRefuel} style={styles.resolveRefuelBtn}>
                <Text style={styles.resolveRefuelBtnText}>Dismiss / Refueled</Text>
              </Pressable>
            </View>
            <Text style={styles.refuelRiderText}>
              {refuelRiderName || 'Rider'} needs petrol stop.
            </Text>
            {refuelNote ? <Text style={styles.refuelNoteText}>&quot;{refuelNote}&quot;</Text> : null}
            <Text style={styles.refuelLowUrgencyTag}>Informational only · Not an emergency</Text>
          </View>
        )}

        {/* VEHICLE BREAKDOWN ALERT BANNER (#F59E0B - TIER 2 WARNING) */}
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

            {/* PRIVACY-GATED MEDICAL ID SNAPSHOT */}
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

        {/* GROUP SEPARATION ALERT BANNER (#F59E0B - TIER 3 INFORMATIONAL) */}
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

          {separationActive && (
            <View style={styles.approxMidpointMarker}>
              <View style={styles.approxMidpointCircle} />
              <Text style={styles.approxMidpointText}>APPROXIMATE MEETING AREA</Text>
            </View>
          )}

          {breakdownActive && (
            <View style={styles.breakdownMapPin}>
              <Text style={styles.breakdownMapPinText}>⚠️ REPAIR</Text>
            </View>
          )}

          {refuelActive && (
            <View style={styles.refuelMapPin}>
              <Text style={styles.refuelMapPinText}>⛽ REFUEL</Text>
            </View>
          )}

          <View style={styles.weatherSlot}>
            <Text style={styles.weatherLabel}>WEATHER SPACE</Text>
            <Text style={styles.weatherCopy}>24°C · Mild Breeze</Text>
          </View>
        </View>

        {/* ROSTER */}
        <View style={styles.memberCard}>
          <View style={styles.memberRowHeader}>
            <Text style={styles.cardTitle}>Ride Group Roster (4 Riders)</Text>
            <Text style={styles.memberCountText}>3 Live GPS</Text>
          </View>

          <View style={styles.rosterList}>
            <View style={styles.rosterItem}>
              <View style={[styles.rosterDot, { backgroundColor: COLORS.green }]} />
              <View style={styles.rosterTextCol}>
                <Text style={styles.rosterNameText}>{riderName} (You)</Text>
                <Text style={styles.rosterVehicleText}>
                  {profile.vehicleModel || 'Royal Enfield Himalayan'} · {profile.plateNumber || 'BA 2 PA 1234'}
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
                <Text style={styles.rosterVehicleText}>
                  Yamaha MT-07 · BA 4 PA 4410
                  {refuelActive && refuelRiderName === 'Maya Lin' ? ' (REFUEL)' : ''}
                </Text>
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

          {/* PETROL REFILL NOTIFICATION BUTTON */}
          <Pressable onPress={onOpenRefuelModal} style={styles.refuelTriggerBtn}>
            <Text style={styles.refuelTriggerBtnText}>⛽ Need Fuel / Request Petrol Stop</Text>
          </Pressable>

          {/* DELIBERATE BREAKDOWN TRIGGER */}
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
        </View>

        {/* DEMO / TEST STATE TOGGLES */}
        <View style={styles.demoControlsBox}>
          <Text style={styles.demoBoxTitle}>TEST DEMO CONTROLS</Text>
          <View style={styles.demoBtnGrid}>
            <Pressable onPress={onSimulateOtherRefuel} style={styles.demoMiniBtn}>
              <Text style={styles.demoMiniBtnText}>Simulate Maya Refuel Alert</Text>
            </Pressable>

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
          <Text style={styles.sosIconText}>🆘</Text>
        </View>
        <Text style={styles.emergencyTitle}>SOS Alert Broadcast</Text>
        <Text style={styles.emergencyCopy}>
          Emergency signals dispatched to group members and saved to server log.
        </Text>

        {hasMedical ? (
          <View style={styles.sosMedicalCard}>
            <Text style={styles.sosMedicalTitle}>🩸 Medical Snapshot Attached</Text>
            <Text style={styles.sosMedicalText}>Blood Group: {profile.bloodGroup}</Text>
            <Text style={styles.sosMedicalText}>Emergency Contact: {profile.emergencyContact}</Text>
          </View>
        ) : null}

        <Button label="Return to map" onPress={onReturn} />
        <Button label="End ride" tone="danger" onPress={onEnd} />
      </ScrollView>
    </Shell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink },
  page: { padding: 20, gap: 16 },
  loginContent: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  shield: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.forest,
    borderColor: '#4ADE80',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  shieldText: { color: COLORS.text, fontWeight: '900', fontSize: 24 },
  brand: { color: COLORS.text, fontSize: 32, fontWeight: '900' },
  lead: { color: COLORS.muted, fontSize: 15, marginBottom: 12 },
  fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
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
  helper: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  portalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  profileBadgeBtn: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  profileBadgeBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  eyebrow: { color: '#86EFAC', fontWeight: '800', fontSize: 11, letterSpacing: 1.1 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800' },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: COLORS.card,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  connectionText: { flex: 1 },
  connectionTitle: { color: COLORS.text, fontWeight: '800', fontSize: 13 },
  connectionDetail: { color: COLORS.muted, fontSize: 12 },
  profileSummaryCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  profileSummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileEditLink: { color: COLORS.blue, fontSize: 12, fontWeight: '700' },
  profileSummaryMeta: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  medicalPillRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  medicalPill: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  medicalPillText: { color: COLORS.muted, fontSize: 11, fontWeight: '600' },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  copy: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  link: { color: COLORS.blue, fontWeight: '700', textDecorationLine: 'underline', marginTop: 4 },
  button: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: COLORS.ink, fontWeight: '900', fontSize: 15 },
  secondaryButton: { backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 1 },
  secondaryButtonText: { color: COLORS.text, fontWeight: '700' },
  dangerButton: { backgroundColor: COLORS.red },
  warningButton: { backgroundColor: COLORS.amber },
  warningButtonText: { color: COLORS.ink, fontWeight: '900' },
  successButton: { backgroundColor: COLORS.green },
  successButtonText: { color: COLORS.ink, fontWeight: '900' },

  // Live Map styles
  mapPage: { padding: 16, gap: 12 },
  mapHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerRightActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerProfileBtn: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  headerProfileBtnText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  mapTitle: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  endRide: { color: COLORS.red, fontWeight: '700', fontSize: 13 },

  // REFUEL BANNER (#16A34A)
  refuelBanner: {
    backgroundColor: '#0A2414',
    borderColor: COLORS.green,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  refuelHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refuelBadge: {
    backgroundColor: '#0F381F',
    borderColor: COLORS.green,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  refuelBadgeText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  resolveRefuelBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  resolveRefuelBtnText: { color: COLORS.muted, fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },
  refuelRiderText: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  refuelNoteText: { color: '#BBF7D0', fontSize: 13, fontStyle: 'italic' },
  refuelLowUrgencyTag: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },

  // BREAKDOWN BANNER
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
    backgroundColor: '#4A3300',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  breakdownBadgeText: { color: COLORS.amber, fontSize: 10, fontWeight: '800' },
  breakdownRiderTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  resolveBtn: {
    backgroundColor: '#382606',
    borderColor: COLORS.amber,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resolveBtnText: { color: COLORS.amber, fontSize: 11, fontWeight: '800' },
  breakdownDetailRow: { gap: 2 },
  breakdownDetailTag: { color: COLORS.amber, fontSize: 12, fontWeight: '800' },
  breakdownDetailMeta: { color: COLORS.muted, fontSize: 12 },
  breakdownNoteText: { color: '#FDE68A', fontSize: 12, fontStyle: 'italic' },
  medicalSnapshotBox: {
    backgroundColor: '#17271B',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  medicalSnapshotToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  medicalSnapshotToggleText: { color: '#86EFAC', fontSize: 11, fontWeight: '800' },
  medicalPrivacyLabel: { color: COLORS.amber, fontSize: 9, fontWeight: '700' },
  medicalSnapshotBody: { marginTop: 6, gap: 2, borderTopWidth: 1, borderTopColor: COLORS.line, paddingTop: 6 },
  medicalSnapshotItem: { color: COLORS.text, fontSize: 11 },
  boldText: { fontWeight: '700' },

  // SEPARATION BANNER
  separationBanner: {
    backgroundColor: '#1C291F',
    borderColor: '#34D399',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  separationHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  separationBadge: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  separationBadgeText: { color: '#6EE7B7', fontSize: 10, fontWeight: '800' },
  separationAutoClearText: { color: COLORS.muted, fontSize: 10 },
  separationRoleBlock: { gap: 4 },
  separationMainTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  speedGuidancePill: {
    backgroundColor: '#065F46',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  speedGuidancePillText: { color: '#A7F3D0', fontSize: 11, fontWeight: '800' },
  slowDownPill: { backgroundColor: '#374151' },
  slowDownPillText: { color: '#E5E7EB' },
  midpointNotice: { color: COLORS.muted, fontSize: 11, marginTop: 2 },

  // MAP CANVAS
  mapCanvas: {
    height: 220,
    backgroundColor: '#0F1A12',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  mapRoad: { color: '#2B4A34', fontWeight: '800', letterSpacing: 2, fontSize: 11 },
  routeOne: {
    position: 'absolute',
    width: '80%',
    height: 3,
    backgroundColor: COLORS.blue,
    transform: [{ rotate: '-12deg' }],
    opacity: 0.6,
  },
  routeTwo: {
    position: 'absolute',
    width: '60%',
    height: 3,
    backgroundColor: COLORS.blue,
    transform: [{ rotate: '25deg' }],
    opacity: 0.4,
  },
  marker: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  markerText: { color: COLORS.text, fontWeight: '800', fontSize: 10 },
  youMarker: { backgroundColor: COLORS.forest, borderColor: COLORS.green, top: 40, left: 60 },
  markerOne: { backgroundColor: COLORS.blue, borderColor: '#60A5FA', top: 120, left: 180 },
  markerTwo: { backgroundColor: COLORS.blue, borderColor: '#60A5FA', top: 160, right: 50 },

  approxMidpointMarker: {
    position: 'absolute',
    top: 90,
    left: 120,
    alignItems: 'center',
    gap: 2,
  },
  approxMidpointCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.amber,
    borderColor: COLORS.text,
    borderWidth: 2,
  },
  approxMidpointText: { color: COLORS.amber, fontSize: 8, fontWeight: '800', backgroundColor: COLORS.ink, paddingHorizontal: 4 },

  breakdownMapPin: {
    position: 'absolute',
    top: 110,
    left: 170,
    backgroundColor: COLORS.red,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  breakdownMapPinText: { color: COLORS.text, fontSize: 8, fontWeight: '800' },

  refuelMapPin: {
    position: 'absolute',
    top: 50,
    left: 90,
    backgroundColor: COLORS.green,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  refuelMapPinText: { color: COLORS.ink, fontSize: 8, fontWeight: '900' },

  weatherSlot: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    backgroundColor: 'rgba(11, 19, 14, 0.8)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  weatherLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '800' },
  weatherCopy: { color: COLORS.text, fontSize: 10, fontWeight: '700' },

  // ROSTER
  memberCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  memberRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memberCountText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  rosterList: { gap: 8 },
  rosterItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rosterDot: { width: 8, height: 8, borderRadius: 4 },
  rosterTextCol: { flex: 1 },
  rosterNameText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  rosterVehicleText: { color: COLORS.muted, fontSize: 11 },
  rosterRoleBadge: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  rosterOfflineText: { color: COLORS.muted, fontSize: 10 },
  breakdownTagSmall: { color: COLORS.amber, fontSize: 10, fontWeight: '800' },

  // CONTROLS & TRIGGERS
  controlsSection: { gap: 10, marginTop: 4 },
  refuelTriggerBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  refuelTriggerBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 15 },
  breakdownTriggerBtn: {
    backgroundColor: '#2A1C06',
    borderColor: COLORS.amber,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  holdProgressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.amber,
    opacity: 0.3,
  },
  breakdownTriggerBtnText: { color: COLORS.amber, fontWeight: '900', fontSize: 14 },

  // DEMO CONTROLS
  demoControlsBox: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginTop: 8,
  },
  demoBoxTitle: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  demoBtnGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoMiniBtn: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  demoMiniBtnText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  demoCrash: { marginTop: 4, alignSelf: 'center' },
  demoCrashText: { color: COLORS.red, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },

  // MODAL STYLES FOR BREAKDOWN REASON
  modalOverlay: { flex: 1, backgroundColor: 'rgba(5, 12, 7, 0.85)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderTopWidth: 2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    gap: 12,
  },
  modalTitle: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  modalCopy: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  reasonOptionList: { gap: 8 },
  reasonOptionBtn: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  reasonOptionBtnSelected: { backgroundColor: '#382606', borderColor: COLORS.amber, borderWidth: 1.5 },
  reasonOptionText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },
  reasonOptionTextSelected: { color: COLORS.text, fontWeight: '900' },
  modalActionRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  confirmBreakdownBtn: {
    flex: 2,
    backgroundColor: COLORS.amber,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBreakdownBtnText: { color: COLORS.ink, fontWeight: '900', fontSize: 14 },
  cancelBreakdownBtn: {
    flex: 1,
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBreakdownBtnText: { color: COLORS.muted, fontWeight: '700', fontSize: 14 },

  // EMERGENCY STATES
  emergencyPage: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  emergencyTitle: { color: COLORS.text, fontSize: 28, fontWeight: '900', textAlign: 'center' },
  emergencyCopy: { color: COLORS.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  countdownCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.card,
    borderColor: COLORS.red,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  countdownNumber: { color: COLORS.red, fontSize: 54, fontWeight: '900' },
  countdownLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  cancelHint: { color: COLORS.muted, fontSize: 12 },
  sosIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#3B0A0A',
    borderColor: COLORS.red,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sosIconText: { fontSize: 32 },
  sosMedicalCard: {
    backgroundColor: '#1E0D0D',
    borderColor: COLORS.red,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    width: '100%',
    gap: 4,
  },
  sosMedicalTitle: { color: COLORS.red, fontSize: 14, fontWeight: '800' },
  sosMedicalText: { color: COLORS.text, fontSize: 12 },
});

export default App;
