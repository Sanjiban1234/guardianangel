import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
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

type Screen = 'login' | 'portal' | 'map' | 'countdown' | 'sos' | 'summary';
type Connection = 'live' | 'offline';

const COLORS = {
  forest: '#14532D', blue: '#2F80ED', amber: '#F59E0B', red: '#DC2626',
  green: '#16A34A', ink: '#0B130E', card: '#142318', line: '#1E3A28', text: '#F0FDF4', muted: '#A3B8A8',
};

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [connection, setConnection] = useState<Connection>('live');
  const [seconds, setSeconds] = useState(15);

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

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.ink} />
      {screen === 'login' && <Login onContinue={() => setScreen('portal')} />}
      {screen === 'portal' && <Portal connection={connection} onStart={() => setScreen('map')} />}
      {screen === 'map' && <LiveMap connection={connection} onToggleConnection={() => setConnection(value => value === 'live' ? 'offline' : 'live')} onCrash={beginCrashCountdown} onEnd={() => setScreen('summary')} />}
      {screen === 'countdown' && <CrashCountdown seconds={seconds} onCancel={() => setScreen('map')} />}
      {screen === 'sos' && <SosConfirmation onReturn={() => setScreen('map')} onEnd={() => setScreen('summary')} />}
      {screen === 'summary' && <RideSummaryScreen data={MOCK_FULL_RIDE_SUMMARY} onReturnToPortal={() => setScreen('portal')} onExportGpx={() => Alert.alert('GPX export', 'Track export will be available when the ride file service is connected.')} />}
    </SafeAreaProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.shell}>{children}</SafeAreaView>;
}

function Button({ label, onPress, tone = 'primary' }: { label: string; onPress: () => void; tone?: 'primary' | 'secondary' | 'danger' }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.button, tone === 'secondary' && styles.secondaryButton, tone === 'danger' && styles.dangerButton]}><Text style={[styles.buttonText, tone === 'secondary' && styles.secondaryButtonText]}>{label}</Text></Pressable>;
}

function Login({ onContinue }: { onContinue: () => void }) {
  const [name, setName] = useState('Alex Vance');
  const [password, setPassword] = useState('guardian1');
  return <Shell>
    <View style={styles.loginContent}>
      <View style={styles.shield}><Text style={styles.shieldText}>GA</Text></View>
      <Text style={styles.brand}>Guardian Angel</Text><Text style={styles.lead}>Sign in to keep your ride group close.</Text>
      <Text style={styles.fieldLabel}>NAME</Text><TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor="#5C7062" style={styles.input} autoCapitalize="words" />
      <Text style={styles.fieldLabel}>PASSWORD</Text><TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#5C7062" style={styles.input} secureTextEntry />
      <Button label="Sign in" onPress={onContinue} />
      <Text style={styles.helper}>JWT sign-in uses your name and password. No social accounts required.</Text>
    </View>
  </Shell>;
}

function Portal({ connection, onStart }: { connection: Connection; onStart: () => void }) {
  return <Shell><View style={styles.page}>
    <Text style={styles.eyebrow}>WELCOME BACK, ALEX</Text><Text style={styles.title}>Ready for the next ride?</Text>
    <ConnectionBanner connection={connection} />
    <View style={styles.card}><Text style={styles.cardTitle}>Start a group ride</Text><Text style={styles.copy}>Create a room and share its group code with your riders.</Text><Button label="Create ride room" onPress={onStart} /></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Join a group ride</Text><TextInput placeholder="Enter group code" placeholderTextColor="#5C7062" style={styles.input} autoCapitalize="characters" /><Button label="Join with group code" tone="secondary" onPress={onStart} /></View>
    <Pressable onPress={() => Alert.alert('Past rides', 'Ride history will appear here when browsing is added.')}><Text style={styles.link}>View past ride summaries</Text></Pressable>
  </View></Shell>;
}

function ConnectionBanner({ connection }: { connection: Connection }) {
  const online = connection === 'live';
  return <View style={[styles.connection, { borderColor: online ? COLORS.green : COLORS.amber }]}><View style={[styles.dot, { backgroundColor: online ? COLORS.green : COLORS.amber }]} /><View style={styles.connectionText}><Text style={styles.connectionTitle}>{online ? 'LIVE — group can see your position' : 'OFFLINE — using local cache'}</Text><Text style={styles.connectionDetail}>{online ? 'Location updates are shared now.' : 'Updates will re-sync when connected.'}</Text></View></View>;
}

function LiveMap({ connection, onToggleConnection, onCrash, onEnd }: { connection: Connection; onToggleConnection: () => void; onCrash: () => void; onEnd: () => void }) {
  return <Shell><View style={styles.mapPage}>
    <View style={styles.mapHeader}><View><Text style={styles.eyebrow}>GROUP CODE GA-8821</Text><Text style={styles.mapTitle}>Saturday Valley Loop</Text></View><Pressable onPress={onEnd}><Text style={styles.endRide}>End ride</Text></Pressable></View>
    <ConnectionBanner connection={connection} />
    <View style={styles.mapCanvas}><Text style={styles.mapRoad}>VALLEY HIGHWAY</Text><View style={styles.routeOne} /><View style={styles.routeTwo} /><Marker label="YOU" style={styles.youMarker} /><Marker label="M" style={styles.markerOne} /><Marker label="J" style={styles.markerTwo} /><Marker label="S" style={styles.markerThree} /><View style={styles.weatherSlot}><Text style={styles.weatherLabel}>WEATHER SPACE</Text><Text style={styles.weatherCopy}>Reserved for v1.1</Text></View></View>
    <View style={styles.memberRow}><Text style={styles.memberText}>4 riders in this session</Text><Text style={styles.memberText}>3 live locations</Text></View>
    <Button label={connection === 'live' ? 'Preview offline state' : 'Reconnect and sync'} tone="secondary" onPress={onToggleConnection} />
    <Button label="Manual traffic override" tone="secondary" onPress={() => Alert.alert('Traffic override', 'This deliberate control would send a route hazard to your group.')} />
    <Pressable accessibilityRole="button" onPress={onCrash} style={styles.demoCrash}><Text style={styles.demoCrashText}>Demo: simulate crash detection</Text></Pressable>
  </View></Shell>;
}

function Marker({ label, style }: { label: string; style: object }) { return <View style={[styles.marker, style]}><Text style={styles.markerText}>{label}</Text></View>; }

function CrashCountdown({ seconds, onCancel }: { seconds: number; onCancel: () => void }) {
  return <Shell><View style={styles.emergencyPage}>
    <Text style={styles.eyebrow}>SAFETY CHECK</Text><Text style={styles.emergencyTitle}>We detected a possible crash.</Text><Text style={styles.emergencyCopy}>An SOS alert will be sent to your ride group unless you cancel.</Text>
    <View style={styles.countdownCircle}><Text style={styles.countdownNumber}>{seconds}</Text><Text style={styles.countdownLabel}>SECONDS</Text></View>
    <Button label="I'M OK — CANCEL ALERT" tone="secondary" onPress={onCancel} />
    <Text style={styles.cancelHint}>Large cancel control · no precision needed</Text>
  </View></Shell>;
}

function SosConfirmation({ onReturn, onEnd }: { onReturn: () => void; onEnd: () => void }) {
  return <Shell><View style={styles.emergencyPage}>
    <View style={styles.sosIcon}><Text style={styles.sosIconText}>!</Text></View><Text style={styles.eyebrow}>SOS SENT</Text><Text style={styles.emergencyTitle}>Help is being notified.</Text><Text style={styles.emergencyCopy}>Your ride group and listed guardians received your last known location. Stay where you are if it is safe.</Text>
    <View style={styles.notifiedCard}><Text style={styles.cardTitle}>Alert recipients</Text><Text style={styles.copy}>Maya, Jordan, Sam and 2 guardians</Text><Text style={styles.sentAt}>Sent now · location attached</Text></View>
    <Button label="Return to live map" onPress={onReturn} /><Button label="End ride and view summary" tone="secondary" onPress={onEnd} />
  </View></Shell>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink }, page: { flex: 1, padding: 24, gap: 16 }, loginContent: { flex: 1, padding: 28, justifyContent: 'center', gap: 12 }, shield: { width: 58, height: 58, borderRadius: 18, backgroundColor: COLORS.forest, justifyContent: 'center', alignItems: 'center', marginBottom: 10 }, shieldText: { color: COLORS.text, fontWeight: '900', fontSize: 20 }, brand: { color: COLORS.text, fontSize: 31, fontWeight: '800' }, lead: { color: COLORS.muted, fontSize: 16, marginBottom: 22 }, eyebrow: { color: '#86EFAC', fontWeight: '800', fontSize: 11, letterSpacing: 1.1 }, title: { color: COLORS.text, fontSize: 28, fontWeight: '800', marginBottom: 6 }, fieldLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: .8, marginTop: 6 }, input: { backgroundColor: '#0F1A12', borderColor: COLORS.line, borderWidth: 1, color: COLORS.text, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15 }, button: { backgroundColor: COLORS.green, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 4 }, buttonText: { color: COLORS.ink, fontWeight: '900', fontSize: 14, letterSpacing: .2 }, secondaryButton: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line }, secondaryButtonText: { color: COLORS.text }, dangerButton: { backgroundColor: COLORS.red }, helper: { color: '#5C7062', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 8 }, card: { backgroundColor: COLORS.card, padding: 18, borderColor: COLORS.line, borderWidth: 1, borderRadius: 16, gap: 10 }, cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' }, copy: { color: COLORS.muted, fontSize: 13, lineHeight: 19 }, link: { color: '#60A5FA', fontWeight: '700', textAlign: 'center', marginTop: 4 }, connection: { backgroundColor: COLORS.card, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, dot: { width: 10, height: 10, borderRadius: 5 }, connectionText: { flex: 1 }, connectionTitle: { color: COLORS.text, fontWeight: '800', fontSize: 12 }, connectionDetail: { color: COLORS.muted, fontSize: 12, marginTop: 2 }, mapPage: { flex: 1, padding: 18, gap: 12 }, mapHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, mapTitle: { color: COLORS.text, fontSize: 21, fontWeight: '800' }, endRide: { color: '#FCA5A5', fontWeight: '800', fontSize: 13 }, mapCanvas: { flex: 1, minHeight: 300, backgroundColor: '#183327', borderRadius: 18, borderColor: '#28523B', borderWidth: 1, overflow: 'hidden', position: 'relative' }, mapRoad: { color: '#73947F', fontSize: 10, fontWeight: '800', letterSpacing: 1, position: 'absolute', top: 46, left: 100 }, routeOne: { height: 9, width: 340, borderRadius: 10, backgroundColor: COLORS.blue, transform: [{ rotate: '-24deg' }], position: 'absolute', top: 150, left: -25 }, routeTwo: { height: 9, width: 280, borderRadius: 10, backgroundColor: COLORS.blue, transform: [{ rotate: '38deg' }], position: 'absolute', top: 170, right: -40 }, marker: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.blue, borderWidth: 3, borderColor: '#DCEBFF', alignItems: 'center', justifyContent: 'center' }, youMarker: { top: 135, left: '45%', backgroundColor: COLORS.forest }, markerOne: { top: 85, left: '25%' }, markerTwo: { top: 215, left: '18%' }, markerThree: { top: 220, right: '20%' }, markerText: { color: '#FFF', fontSize: 11, fontWeight: '900' }, weatherSlot: { position: 'absolute', top: 14, right: 14, backgroundColor: '#102015', borderColor: COLORS.line, borderWidth: 1, padding: 10, borderRadius: 10 }, weatherLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '800' }, weatherCopy: { color: '#5C7062', fontSize: 10, marginTop: 2 }, memberRow: { flexDirection: 'row', justifyContent: 'space-between' }, memberText: { color: COLORS.muted, fontSize: 12 }, demoCrash: { alignItems: 'center', padding: 10 }, demoCrashText: { color: '#FCA5A5', fontWeight: '700', fontSize: 12 }, emergencyPage: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 18 }, emergencyTitle: { color: COLORS.text, fontSize: 29, fontWeight: '900', textAlign: 'center', lineHeight: 35 }, emergencyCopy: { color: COLORS.muted, textAlign: 'center', lineHeight: 22, fontSize: 15 }, countdownCircle: { width: 190, height: 190, borderRadius: 95, borderWidth: 9, borderColor: COLORS.red, backgroundColor: '#311214', justifyContent: 'center', alignItems: 'center', marginVertical: 10 }, countdownNumber: { color: '#FCA5A5', fontSize: 68, fontWeight: '900' }, countdownLabel: { color: '#FCA5A5', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, cancelHint: { color: COLORS.muted, fontSize: 12 }, sosIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4A1215', borderWidth: 2, borderColor: COLORS.red, alignItems: 'center', justifyContent: 'center' }, sosIconText: { color: '#FCA5A5', fontSize: 40, fontWeight: '900' }, notifiedCard: { alignSelf: 'stretch', backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 1, borderRadius: 14, padding: 16, gap: 7 }, sentAt: { color: '#86EFAC', fontSize: 12, fontWeight: '700' },
});

export default App;
