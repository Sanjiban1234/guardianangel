import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  check,
  PERMISSIONS,
  RESULTS,
} from 'react-native-permissions';
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
import LoginScreen from './src/ui/LoginScreen';
import RideSummaryScreen from './src/ui/RideSummaryScreen';
import RiderProfileScreen, {
  INITIAL_PROFILE_DATA,
  RiderProfileData,
} from './src/ui/RiderProfileScreen';
import { SocketClient } from './src/telemetry/socket/SocketClient';
import FriendsScreen from './src/friends/FriendsScreen';
import { TelemetryModule } from './src/telemetry';
import { CommunityGeolocationProvider } from './src/telemetry/location/LocationProvider';
import {
  emitLatestLocationAfterJoin,
  getCurrentPositionAfterJoin,
  hasValidLatestLocation,
  LatestLocationSnapshot,
  resendLatestLocationForJoinedMember,
} from './src/telemetry/location/postJoinLocation';
import { useCrashDetection } from './src/safety/crash/useCrashDetection';
import { useCountdown } from './src/safety/countdown/useCountdown';
import { API_BASE_URL } from './src/config/env';
import MapScreen from './src/ui/MapScreen';
import RideControlsScreen from './src/ui/RideControlsScreen';
import PermissionGate from './src/permissions/PermissionGate';
import {
  ActiveRideRecovery,
  clearActiveRide,
  clearSession,
  loadActiveRide,
  loadSession,
  saveActiveRide,
  saveSession,
} from './src/ride/ActiveRideStore';
import { clearBiometricLogin } from './src/ui/utils/SecureStore';
import {
  clearAllSeparations,
  clearRiderSeparation,
  recordSeparation,
  RiderSeparations,
} from './src/separation/SeparationState';
import {
  clearRideAlerts,
  clearWeatherRideAlerts,
  dismissRideAlert,
  enqueueRideAlert,
  RideAlert,
  RideAlertState,
} from './src/ride/RideAlertStore';
import { RideMetricsAccumulator, MetricsSnapshot } from './src/telemetry/RideMetricsAccumulator';
import {
  RouteProgressTracker,
  RouteProgressSnapshot,
  RouteResult,
  createGoogleDirectionsProvider,
  EMPTY_ROUTE_PROGRESS,
} from './src/navigation/RouteProgressTracker';
import { DeadEndDetector, DeadEndState, DEAD_END_STATE_CLEAR } from './src/navigation/DeadEndDetector';

type Screen =
  | 'login'
  | 'registration'
  | 'portal'
  | 'permission_gate'
  | 'create_destination'
  | 'join'
  | 'map'
  | 'controls'
  | 'countdown'
  | 'sos'
  | 'summary'
  | 'profile'
  | 'friends';

type Connection = 'live' | 'offline';
type BreakdownReason = 'flat_tire' | 'mechanical_failure' | 'fuel' | 'other';

function formatDistanceMeters(distance: unknown): string | undefined {
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) return undefined;
  return distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
}

function formatSpeedKph(speedMetersPerSecond: unknown): string | undefined {
  if (typeof speedMetersPerSecond !== 'number' || !Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond < 0) return undefined;
  return `${Math.round(speedMetersPerSecond * 3.6)} km/h`;
}

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
  const [restoringRide, setRestoringRide] = useState(true);
  const [connection, setConnection] = useState<Connection>('offline');
  const [authToken, setAuthToken] = useState('');
  const [friendsRefreshSignal, setFriendsRefreshSignal] = useState(0);
  const [fineLocationGranted, setFineLocationGranted] = useState(false);
  const fineLocationGrantedRef = useRef(false);
  const socketRef = useRef(new SocketClient());
  const appStateRef = useRef(AppState.currentState || 'unknown');
  const socketLifecycleGuard = React.useMemo(() => {
    const real = socketRef.current;
    return {
      connect: async () => {},
      disconnect: () => {},
      isConnected: () => real.isConnected(),
      joinSession: (gc: string) => real.joinSession(gc),
      emitLocationUpdate: (p: any) => real.emitLocationUpdate(p),
      emitBulkSync: (r: any) => real.emitBulkSync(r),
      onConnect: (l: () => void) => real.onConnect(l),
      onDisconnect: (l: () => void) => real.onDisconnect(l),
      emitEvent: (e: string, p?: any) => real.emitEvent(e, p),
      emitWithAck: (e: string, cb: (r: any) => void) => real.emitWithAck(e, cb),
      onEvent: (e: string, l: (p: any) => void) => real.onEvent(e, l),
    };
  }, []);

  const telemetryModuleRef = useRef(
    new TelemetryModule({
      socketClient: socketLifecycleGuard as any,
      locationProvider: new CommunityGeolocationProvider(),
    })
  );

  const telemetryStream$ = React.useMemo(
    () => ({
      subscribe: (cb: (r: { timestamp: number; latitude: number; longitude: number; accuracy: number; speed: number | null }) => void) => {
        const unsubscribe = telemetryModuleRef.current.onReading((reading) => {
          cb({
            timestamp: reading.timestamp,
            latitude: reading.latitude,
            longitude: reading.longitude,
            accuracy: reading.accuracy,
            speed: reading.speed,
          });
        });
        return { unsubscribe };
      },
    }),
    []
  );

  const lastCrashLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const { lastCandidate } = useCrashDetection({ apiBaseUrl: API_BASE_URL, telemetryStream$ });
  const countdown = useCountdown({ durationMs: 15_000 });

  // Registration gate state
  const [hasCompletedRegistration, setHasCompletedRegistration] = useState(false);
  const [riderName, setRiderName] = useState('');
  const riderNameRef = useRef(riderName);
  const [riderEmail, setRiderEmail] = useState('');
  const [userId, setUserId] = useState('');

  // Profile data state
  const [profile, setProfile] = useState<RiderProfileData>(INITIAL_PROFILE_DATA);

  // Room / Destination state
  const [activeRoomCode, setActiveRoomCode] = useState<string>('');
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  // This deliberately is not persisted.  It identifies a completed room long
  // enough to fetch its authoritative post-ride summary without treating the
  // ended room as an active membership on a later launch.
  const [completedRideSummaryContext, setCompletedRideSummaryContext] = useState<{ groupCode: string } | null>(null);
  const [destinationTitle, setDestinationTitle] = useState<string>('');
  const [roomMembers, setRoomMembers] = useState<Array<{
    user_id: string; name: string; role?: string; isYou?: boolean;
    vehicleModel?: string; plateNumber?: string;
    latitude?: number; longitude?: number; accuracy?: number; lastUpdatedAt?: number;
    connectionState?: 'CONNECTED' | 'DISCONNECTED'; locationFreshness?: 'FRESH' | 'STALE'; rideState?: 'active' | 'paused';
  }>>([]);
  const roomMembersRef = useRef(roomMembers);
  const [currentLocation, setCurrentLocation] = useState<LatestLocationSnapshot | null>(null);
  const currentLocationRef = useRef<LatestLocationSnapshot | null>(null);
  const postJoinCurrentPositionRef = useRef<Promise<LatestLocationSnapshot> | null>(null);
  const [destination, setDestination] = useState<{ latitude: number; longitude: number; label: string } | null>(null);
  const activeRoomCodeRef = useRef(activeRoomCode);

  useEffect(() => {
    activeRoomCodeRef.current = activeRoomCode;
  }, [activeRoomCode]);

  useEffect(() => {
    const updateSocketAppState = (state: string) => (socketRef.current as any).setAppState?.(state);
    updateSocketAppState(appStateRef.current);
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      updateSocketAppState(nextState);
      console.log(`[TEMP SOCKET DIAG] app_state=${nextState} socket_active=${socketRef.current.isConnected()}`);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    roomMembersRef.current = roomMembers;
  }, [roomMembers]);

  useEffect(() => {
    fineLocationGrantedRef.current = fineLocationGranted;
  }, [fineLocationGranted]);

  useEffect(() => {
    riderNameRef.current = riderName;
  }, [riderName]);

  // Refuel alert state
  const [refuelActive, setRefuelActive] = useState<boolean>(false);
  const [refuelRiderName, setRefuelRiderName] = useState<string>('');
  const [refuelNote, setRefuelNote] = useState<string>('');
  const [showRefuelModal, setShowRefuelModal] = useState<boolean>(false);

  // Breakdown state
  const [breakdownActive, setBreakdownActive] = useState<boolean>(false);
  const [breakdownReason, setBreakdownReason] = useState<BreakdownReason>('flat_tire');
  const [breakdownNote, setBreakdownNote] = useState<string>('');
  const [breakdownRiderName, setBreakdownRiderName] = useState<string>('');
  const [breakdownVehicleModel, setBreakdownVehicleModel] = useState<string>('');
  const [breakdownPlateNumber, setBreakdownPlateNumber] = useState<string>('');
  const [breakdownRiderId, setBreakdownRiderId] = useState<string>('');
  const breakdownRiderIdRef = useRef<string>('');
  const [showReasonModal, setShowReasonModal] = useState<boolean>(false);

  // Separation is keyed by the rider the server identified, so one reunion
  // cannot erase a different rider's active warning.
  const [separationsByRider, setSeparationsByRider] = useState<RiderSeparations>({});
  const [rideAlertState, setRideAlertState] = useState<RideAlertState>(clearRideAlerts());
  const dismissActiveRideAlert = useCallback((alertId: string) => {
    setRideAlertState(previous => dismissRideAlert(previous, alertId));
  }, []);
  const addRideAlert = useCallback((alert: RideAlert) => {
    setRideAlertState(previous => enqueueRideAlert(previous, alert));
  }, []);
  const handleWeatherAdvisory = useCallback((advisory: { type?: string; severity: 'info' | 'warning'; title: string; message: string }, snapshotKey: string) => {
    const semanticType = advisory.type || advisory.title;
    addRideAlert({ id: `${semanticType}:${snapshotKey}`, type: 'WEATHER', severity: advisory.severity, timestamp: Date.now(), title: advisory.title, message: advisory.message, dedupeKey: `weather:${semanticType}:${snapshotKey}` });
  }, [addRideAlert]);
  const [permissionIntent, setPermissionIntent] = useState<'create' | 'join' | null>(null);

  // Ride start state
  const [rideStarted, setRideStarted] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isPauseActionPending, setIsPauseActionPending] = useState(false);
  const pauseActionGenerationRef = useRef(0);
  const [isStartingRide, setIsStartingRide] = useState<boolean>(false);
  const startRideInFlightRef = useRef(false);
  const endRideInFlightRef = useRef(false);
  const leaveRideInFlightRef = useRef(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [deviceRole, setDeviceRole] = useState<'HOST' | 'RIDER' | 'UNKNOWN'>('UNKNOWN');
  const reconnectingRef = useRef(false);

  // Live ride stats
  const [liveMetrics, setLiveMetrics] = useState<MetricsSnapshot | null>(null);
  const [routeProgress, setRouteProgress] = useState<RouteProgressSnapshot | null>(null);
  const [deadEndState, setDeadEndState] = useState<DeadEndState>(DEAD_END_STATE_CLEAR);
  const [activeRoute, setActiveRoute] = useState<RouteResult | null>(null);

  const metricsAccumulatorRef = useRef<RideMetricsAccumulator | null>(null);
  const routeTrackerRef = useRef<RouteProgressTracker | null>(null);
  const deadEndDetectorRef = useRef<DeadEndDetector | null>(null);

  // Initialise feature services once (stable across renders)
  if (!routeTrackerRef.current) {
    const apiKey = typeof process !== 'undefined' && process.env
      ? (process.env.GOOGLE_MAPS_API_KEY ?? '')
      : '';
    routeTrackerRef.current = new RouteProgressTracker(
      createGoogleDirectionsProvider(apiKey),
    );
  }
  if (!deadEndDetectorRef.current) {
    deadEndDetectorRef.current = new DeadEndDetector(null);
    deadEndDetectorRef.current.onStateChange((s) => setDeadEndState({ ...s }));
  }

  const clearActiveRideState = async (nextScreen: Screen = 'portal') => {
    await clearActiveRide().catch(() => {});
    console.log('[ACTIVE RIDE CLEARED]');
    setActiveRoomCode('');
    setDestinationTitle('');
    setDestination(null);
    setRoomMembers([]);
    setSeparationsByRider(clearAllSeparations());
    setRideAlertState(clearRideAlerts());
    setRideStarted(false);
    setIsPaused(false);
    setIsPauseActionPending(false);
    pauseActionGenerationRef.current += 1;
    setActiveRoute(null);
    setIsHost(false);
    setDeviceRole('UNKNOWN');
    endRideInFlightRef.current = false;
    leaveRideInFlightRef.current = false;
    setScreen(nextScreen);
    console.log('[SCREEN UPDATED]');
  };

  const handleLogout = async () => {
    const token = authToken;
    // Local cleanup is authoritative: never strand an offline user in an authenticated session.
    void telemetryModuleRef.current.stop().catch(() => {});
    socketRef.current.disconnect();
    await clearActiveRide().catch(() => {});
    await clearSession().catch(() => {});
    await clearBiometricLogin().catch(() => {});
    setAuthToken(''); setUserId(''); setRiderName(''); setRiderEmail('');
    setHasCompletedRegistration(false); setCompletedRideSummaryContext(null);
    setActiveRoomCode(''); setRideStarted(false); setRoomMembers([]); setScreen('login');
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch {
        console.warn('server logout unavailable; local session cleared');
      }
    }
  };

  const showCompletedRideSummary = (groupCode: string) => {
    if (!groupCode) return;
    console.log('[SUMMARY CONTEXT SET]');
    setCompletedRideSummaryContext({ groupCode });
    void clearActiveRideState('summary');
  };

  const persistActiveRide = (ride: ActiveRideRecovery) => {
    saveActiveRide(ride).catch(() => console.warn('[ACTIVE RIDE RESTORE] persist failed'));
  };

  // Update current location from telemetry + feed live stats + route + dead-end
  useEffect(() => {
    const subscription = telemetryStream$.subscribe((reading) => {
      const location = {
        timestamp: reading.timestamp,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy: reading.accuracy,
        speed: reading.speed,
      };
      setCurrentLocation(location);
      currentLocationRef.current = location;

      // Feed live stats accumulator
      if (metricsAccumulatorRef.current) {
        metricsAccumulatorRef.current.addReading(reading);
        setLiveMetrics(metricsAccumulatorRef.current.snapshot());
      }

      // Feed route progress tracker (non-blocking — rate-limited internally)
      if (routeTrackerRef.current) {
        void routeTrackerRef.current.updatePosition({
          latitude: reading.latitude,
          longitude: reading.longitude,
        }).then((snap) => setRouteProgress(snap));
      }

      // Feed dead-end detector
      if (deadEndDetectorRef.current) {
        deadEndDetectorRef.current.processReading({
          timestamp: reading.timestamp,
          latitude: reading.latitude,
          longitude: reading.longitude,
          accuracy: reading.accuracy,
          speed: reading.speed,
        });
      }
    });
    return () => subscription.unsubscribe();
  }, [telemetryStream$]);

  const updateLatestLocation = (location: LatestLocationSnapshot) => {
    currentLocationRef.current = location;
    setCurrentLocation(location);
  };

  const handleTogglePause = useCallback(() => {
    if (isPauseActionPending || !activeRoomCodeRef.current || !socketRef.current.isConnected()) {
      Alert.alert('Ride status unavailable', 'Reconnect to the ride before changing your pause status.');
      return;
    }
    const event = isPaused ? 'ride:resume' : 'ride:pause';
    const requestGeneration = ++pauseActionGenerationRef.current;
    setIsPauseActionPending(true);
    try {
      socketRef.current.emitEventWithAck(event, { group_code: activeRoomCodeRef.current }, (response: any) => {
        if (requestGeneration !== pauseActionGenerationRef.current) return;
        setIsPauseActionPending(false);
        if (!response?.success) {
          Alert.alert('Unable to update ride status', response?.error || 'The server did not accept this change.');
          return;
        }
        // The server acknowledgement is authoritative; the room broadcast also
        // updates peers and reconnect hydration below.
        setIsPaused(event === 'ride:pause');
      });
    } catch {
      setIsPauseActionPending(false);
      Alert.alert('Ride status unavailable', 'Reconnect to the ride before changing your pause status.');
    }
  }, [isPaused, isPauseActionPending]);

  const handleActiveRouteChanged = useCallback((route: RouteResult) => {
    setActiveRoute(route);
    setRideAlertState(previous => clearWeatherRideAlerts(previous));
    routeTrackerRef.current?.ingestRoute(route);
    const position = currentLocationRef.current;
    setRouteProgress(routeTrackerRef.current?.getSnapshot(position ? { latitude: position.latitude, longitude: position.longitude } : null) ?? null);
    deadEndDetectorRef.current?.acknowledgeReroute();
  }, []);

  // Freshness is server-authored on socket events, then aged locally so a
  // quiet/stalled peer is not rendered as live indefinitely between events.
  useEffect(() => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return;
    const interval = setInterval(() => {
      const now = Date.now();
      setRoomMembers((prev) => prev.map((member) => {
        if (member.isYou || member.name === riderName || member.connectionState === 'DISCONNECTED') {
          return member;
        }
        const freshness = member.lastUpdatedAt != null && now - member.lastUpdatedAt <= 15_000
          ? 'FRESH' : 'STALE';
        return member.locationFreshness === freshness ? member : { ...member, locationFreshness: freshness };
      }));
    }, 5_000);
    return () => clearInterval(interval);
  }, [riderName]);

  const getPostJoinCurrentPosition = async (): Promise<LatestLocationSnapshot | null> => {
    if (!fineLocationGrantedRef.current) return null;
    if (!postJoinCurrentPositionRef.current) {
      postJoinCurrentPositionRef.current = getCurrentPositionAfterJoin(Geolocation)
        .finally(() => { postJoinCurrentPositionRef.current = null; });
    }
    try {
      const location = await postJoinCurrentPositionRef.current;
      updateLatestLocation(location);
      return location;
    } catch {
      return null;
    }
  };

  const emitLocationAfterJoinWithFallback = async (groupCode: string) => {
    const cachedLocation = currentLocationRef.current;
    if (hasValidLatestLocation(cachedLocation)) {
      emitLatestLocationAfterJoin(socketRef.current, groupCode, cachedLocation);
      return;
    }
    console.log('[POST-JOIN LOCATION CACHE MISS]');
    const location = await getPostJoinCurrentPosition();
    if (location) emitLatestLocationAfterJoin(socketRef.current, groupCode, location);
  };

  const resendLocationForJoinedMemberWithFallback = async (groupCode: string, payload: any) => {
    if (!socketRef.current.isConnected() || !payload?.user_id || payload.name === riderNameRef.current) return;
    const cachedLocation = currentLocationRef.current;
    if (hasValidLatestLocation(cachedLocation)) {
      resendLatestLocationForJoinedMember(socketRef.current, groupCode, riderNameRef.current, payload, cachedLocation);
      return;
    }
    console.log('[POST-JOIN LOCATION CACHE MISS]');
    const location = await getPostJoinCurrentPosition();
    if (location) {
      resendLatestLocationForJoinedMember(socketRef.current, groupCode, riderNameRef.current, payload, location);
    }
  };

  const resendLocationAfterReconnect = async (groupCode: string) => {
    const cachedLocation = currentLocationRef.current;
    if (hasValidLatestLocation(cachedLocation)) {
      console.log('[RECONNECT LOCATION RESEND]');
      emitLatestLocationAfterJoin(socketRef.current, groupCode, cachedLocation);
      return;
    }
    console.log('[RECONNECT LOCATION CACHE MISS]');
    const location = await getPostJoinCurrentPosition();
    if (!location) {
      console.warn('[RECONNECT CURRENT POSITION ERROR] no location available');
      return;
    }
    console.log('[RECONNECT CURRENT POSITION SUCCESS]');
    emitLatestLocationAfterJoin(socketRef.current, groupCode, location);
  };

  useEffect(() => {
    if (!authToken) {
      setFineLocationGranted(false);
      return;
    }
    const foregroundPermission = Platform.OS === 'ios'
      ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE
      : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;
    check(foregroundPermission)
      .then((result) => setFineLocationGranted(result === RESULTS.GRANTED))
      .catch(() => setFineLocationGranted(false));
  }, [authToken]);

  // A process kill is not a leave.  Restore only after the backend confirms the
  // persisted user remains a member of an active room.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [token, ride] = await Promise.all([loadSession(), loadActiveRide()]);
      if (!ride || !token) {
        if (ride && !token) await clearActiveRide();
        if (!cancelled) setRestoringRide(false);
        return;
      }
      console.log('[ACTIVE RIDE RESTORE] found persisted ride');
      if (!cancelled) {
        setRideAlertState(clearRideAlerts());
        // Restore authentication independently of whether this particular ride
        // remains valid, so an ended ride returns to the normal portal flow.
        setAuthToken(token);
        setUserId(ride.userId);
        setRiderName(ride.riderName);
        setHasCompletedRegistration(true);
      }
      try {
        const response = await fetch(`${API_BASE_URL}/api/rooms/${ride.groupCode}/session`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          await clearActiveRide();
          if (!cancelled) {
            console.log('[ACTIVE RIDE RESTORE] invalid -> cleared');
            setScreen('portal');
          }
          return;
        }
        const restored = await response.json();
        if (cancelled) return;
        setAuthToken(token);
        setUserId(ride.userId);
        setRiderName(ride.riderName);
        void fetch(`${API_BASE_URL}/api/users/profile`, { headers: { Authorization: `Bearer ${token}` } })
          .then(response => response.ok ? response.json() : null)
          .then(body => body?.profile && setProfile(prev => ({ ...prev,
            username: body.profile.username || '',
            vehicleModel: body.profile.vehicle_model || '',
            plateNumber: body.profile.plate_number || '',
            vehicleColor: body.profile.vehicle_color || '',
          })))
          .catch(() => console.warn('[PROFILE HYDRATE] vehicle profile unavailable'));
        void fetch(`${API_BASE_URL}/api/users/medical-info`, { headers: { Authorization: `Bearer ${token}` } })
          .then(response => response.ok ? response.json() : null)
          .then(body => {
            const medical = body?.medical_info;
            if (!medical) return;
            setProfile(prev => ({ ...prev, bloodGroup: medical.blood_group || 'Skip / Unknown', allergies: medical.allergies || '',
              emergencyContact: [medical.emergency_contact_name, medical.emergency_contact_phone].filter(Boolean).join(' '), medicalNotes: medical.notes || '' }));
          })
          .catch(() => console.warn('[PROFILE HYDRATE] unavailable'));
        setActiveRoomCode(ride.groupCode);
        setDestinationTitle(restored.destination?.label || ride.destinationTitle);
        setDestination(restored.destination ? {
          latitude: restored.destination.latitude,
          longitude: restored.destination.longitude,
          label: restored.destination.label || ride.destinationTitle,
        } : ride.destination);
        const owner = restored.role === 'owner';
        setIsHost(owner);
        setDeviceRole(owner ? 'HOST' : 'RIDER');
        setRideStarted(Boolean(restored.rideStartedAt));
        setScreen('map');
        console.log('[ACTIVE RIDE RESTORE] validated');
      } catch (error) {
        if (!cancelled) {
          console.warn('[ACTIVE RIDE RESTORE] validation unavailable; retaining persisted ride for retry');
          setScreen('portal');
        }
      } finally {
        if (!cancelled) setRestoringRide(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Track event-listener cleanup functions so reconnects don't accumulate duplicates
  const eventCleanupsRef = useRef<Array<() => void>>([]);
  const telemetryEffectGenerationRef = useRef(0);

  useEffect(() => {
    if (!authToken) return;
    const effectGeneration = ++telemetryEffectGenerationRef.current;
    const unsubscribeConnect = socketRef.current.onConnect(() => {
      const transport = (socketRef.current as any).socket?.io?.engine?.transport?.name || 'unknown';
      const roomCode = activeRoomCodeRef.current;
      console.log('[SOCKET DIAG] [APP_ONCONNECT]');
      console.log(`[LIVE LOCATION AUDIT] Socket connected, registering event listeners`);
      setConnection('live');
      const reconnecting = reconnectingRef.current;
      reconnectingRef.current = false;
      if (reconnecting) console.log('[NETWORK RECONNECT] socket reconnected');

      // Tear down previous event listeners before registering new ones
      for (const cleanup of eventCleanupsRef.current) cleanup();
      eventCleanupsRef.current = [];

      // Register event listeners and collect their cleanup functions
      const listen = (event: string, handler: (payload: any) => void) => {
        eventCleanupsRef.current.push(socketRef.current.onEvent(event, handler));
      };
      for (const event of ['friend:request', 'friend:accepted', 'friend:removed', 'ride:invitation']) {
        listen(event, () => setFriendsRefreshSignal((value) => value + 1));
      }

      listen('session:joined', (payload: any) => {
        console.log(`[LIVE LOCATION AUDIT] session:joined received, members: ${payload?.members?.length ?? 0}`);
        console.log(`[LIVE LOCATION DIAG] [BOUNDARY-F] session:joined received | role=${deviceRole} members=${payload?.members?.length || 0}`);
        if (payload?.members && Array.isArray(payload.members)) {
          setRoomMembers((prev) => {
            const prevMap = new Map(prev.map((m) => [m.user_id, m]));
            return payload.members.map((m: any) => {
              const existing = prevMap.get(m.user_id);
              console.log('[SESSION MEMBER UPDATED]');
              return {
                user_id: m.user_id,
                name: m.name,
                role: m.role,
                vehicleModel: m.vehicle_model ?? existing?.vehicleModel,
                plateNumber: m.plate_number ?? existing?.plateNumber,
                isYou: m.name === riderName,
                // Preserve existing coordinates if the server payload has none
                latitude: m.latitude ?? existing?.latitude,
                longitude: m.longitude ?? existing?.longitude,
                accuracy: m.accuracy ?? existing?.accuracy,
                lastUpdatedAt: m.last_updated_at ?? existing?.lastUpdatedAt,
                connectionState: m.connection_state ?? existing?.connectionState ?? 'DISCONNECTED',
                locationFreshness: m.location_freshness ?? existing?.locationFreshness ?? 'STALE',
                rideState: m.ride_state ?? existing?.rideState ?? 'active',
              };
            });
          });
        }
        if (payload?.ride_started_at) {
          setRideStarted(true);
          setScreen('map');
        }
        const self = payload?.members?.find((member: any) => member.user_id === userId);
        if (self?.ride_state) setIsPaused(self.ride_state === 'paused');
      });

      listen('session:member_joined', (payload: any) => {
        if (payload?.user_id) {
          const existingMember = roomMembersRef.current.find((member) =>
            member.user_id === payload.user_id || member.name === payload.name
          );
          if (existingMember?.connectionState === 'DISCONNECTED') {
            addRideAlert({
              id: `reconnected:${payload.user_id}:${payload.timestamp || Date.now()}`,
              type: 'RIDER_RECONNECTED', severity: 'info', timestamp: payload.timestamp || Date.now(),
              title: `${payload.name} reconnected`, riderId: payload.user_id, riderName: payload.name,
              dedupeKey: `reconnected:${payload.user_id}`,
            });
          } else if (!existingMember) {
            addRideAlert({
              id: `joined:${payload.user_id}:${payload.timestamp || Date.now()}`,
              type: 'RIDER_JOINED', severity: 'info', timestamp: payload.timestamp || Date.now(),
              title: `${payload.name} joined the ride`, riderId: payload.user_id, riderName: payload.name,
              vehicleModel: payload.vehicle_model, plateNumber: payload.plate_number,
              dedupeKey: `joined:${payload.user_id}`,
            });
          }
          setRoomMembers((prev) => {
            const existing = prev.find((m) => m.user_id === payload.user_id || m.name === payload.name);
            if (existing) {
              return prev.map(member => member.user_id === existing.user_id
                ? { ...member, vehicleModel: payload.vehicle_model ?? member.vehicleModel,
                  plateNumber: payload.plate_number ?? member.plateNumber,
                  connectionState: payload.connection_state || 'CONNECTED',
                  locationFreshness: payload.location_freshness || member.locationFreshness }
                : member);
            }
            return [...prev, { user_id: payload.user_id, name: payload.name, isYou: false,
              vehicleModel: payload.vehicle_model, plateNumber: payload.plate_number,
              connectionState: payload.connection_state || 'CONNECTED', locationFreshness: payload.location_freshness || 'STALE' }];
          });
          resendLocationForJoinedMemberWithFallback(activeRoomCodeRef.current, payload);
        }
      });

      listen('session:member_left', (payload: any) => {
        if (payload?.user_id) {
          setRoomMembers((prev) => prev.filter((m) => m.user_id !== payload.user_id));
          setSeparationsByRider((prev) => clearRiderSeparation(prev, payload.user_id));
          if (payload?.name) addRideAlert({
            id: `left:${payload.user_id}:${payload.timestamp || Date.now()}`,
            type: 'RIDER_LEFT', severity: 'warning', timestamp: payload.timestamp || Date.now(),
            title: `${payload.name} left the ride`, riderId: payload.user_id, riderName: payload.name,
            dedupeKey: `left:${payload.user_id}`,
          });
        }
      });
      listen('ride:ended', (payload: { group_code?: string }) => {
        pauseActionGenerationRef.current += 1;
        setIsPauseActionPending(false);
        const groupCode = payload?.group_code || activeRoomCodeRef.current;
        if (!groupCode) return;
        console.log('[RIDE ENDED EVENT]');
        Alert.alert('Ride ended', 'The host ended this ride.');
        showCompletedRideSummary(groupCode);
      });
      listen('ride:paused', (payload: any) => {
        if (!payload?.user_id) return;
        setRoomMembers(prev => prev.map(member => member.user_id === payload.user_id ? { ...member, rideState: 'paused' } : member));
        if (payload.user_id === userId) setIsPaused(true);
      });
      listen('ride:resumed', (payload: any) => {
        if (!payload?.user_id) return;
        setRoomMembers(prev => prev.map(member => member.user_id === payload.user_id ? { ...member, rideState: 'active' } : member));
        if (payload.user_id === userId) setIsPaused(false);
      });
      listen('location:broadcast', (payload: any) => {
        console.log('[LOCATION BROADCAST RECEIVED]');
        if (payload?.user_id && payload?.name) {
          const existingMember = roomMembersRef.current.find(member => member.user_id === payload.user_id);
          if (existingMember?.connectionState === 'DISCONNECTED') {
            addRideAlert({
              id: `reconnected:${payload.user_id}:${payload.last_updated_at || Date.now()}`,
              type: 'RIDER_RECONNECTED', severity: 'info', timestamp: payload.last_updated_at || Date.now(),
              title: `${payload.name} reconnected`, riderId: payload.user_id, riderName: payload.name,
              dedupeKey: `reconnected:${payload.user_id}`,
            });
          }
          setRoomMembers((prev) => {
            const existing = prev.find((m) => m.user_id === payload.user_id);
            if (existing) {
              console.log('[LIVE LOCATION DIAG] member updated');
              return prev.map((m) =>
                m.user_id === payload.user_id
                  ? { ...m, latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy,
                    lastUpdatedAt: payload.last_updated_at, connectionState: payload.connection_state || 'CONNECTED',
                    locationFreshness: payload.location_freshness || 'FRESH' }
                  : m
              );
            }
            if (payload.name !== riderName) {
              console.log('[LIVE LOCATION DIAG] member added');
              return [...prev, {
                user_id: payload.user_id,
                name: payload.name,
                isYou: false,
                vehicleModel: payload.vehicle_model,
                plateNumber: payload.plate_number,
                latitude: payload.latitude,
                longitude: payload.longitude,
                accuracy: payload.accuracy,
                lastUpdatedAt: payload.last_updated_at,
                connectionState: payload.connection_state || 'CONNECTED',
                locationFreshness: payload.location_freshness || 'FRESH',
              }];
            }
            console.log('[LIVE LOCATION DIAG] self broadcast skipped');
            return prev;
          });
        } else {
          console.log('[LIVE LOCATION DIAG] invalid broadcast payload');
        }
      });

      listen('peer:lastKnown', (payload: any) => {
        if (payload?.user_id && payload?.name) {
          const existingMember = roomMembersRef.current.find(member => member.user_id === payload.user_id);
          if (existingMember?.connectionState !== 'DISCONNECTED') {
            addRideAlert({
              id: `disconnected:${payload.user_id}:${payload.timestamp || Date.now()}`,
              type: 'RIDER_DISCONNECTED', severity: 'warning', timestamp: payload.timestamp || Date.now(),
              title: `${payload.name} disconnected`, message: 'Showing their last known location.',
              riderId: payload.user_id, riderName: payload.name,
              vehicleModel: existingMember?.vehicleModel, plateNumber: existingMember?.plateNumber,
              dedupeKey: `disconnected:${payload.user_id}`,
            });
          }
          setRoomMembers((prev) => {
            const existing = prev.find((m) => m.user_id === payload.user_id);
            if (existing) {
              return prev.map((m) =>
                m.user_id === payload.user_id
                  ? { ...m, latitude: payload.latitude, longitude: payload.longitude,
                    lastUpdatedAt: payload.timestamp, connectionState: 'DISCONNECTED', locationFreshness: 'STALE' }
                  : m
              );
            }
            return [...prev, {
              user_id: payload.user_id,
              name: payload.name,
              isYou: false,
              latitude: payload.latitude,
                longitude: payload.longitude,
                lastUpdatedAt: payload.timestamp,
                connectionState: 'DISCONNECTED',
                locationFreshness: 'STALE',
            }];
          });
        }
      });

      listen('refill:notified', (payload) => {
        setRefuelRiderName(payload.name);
        setRefuelNote(payload.note || '');
        setRefuelActive(true);
        addRideAlert({
          id: `refuel:${payload.refill_id}`, type: 'REFUEL_REQUEST', severity: 'info', timestamp: payload.timestamp || Date.now(),
          title: `${payload.name} requested a fuel stop`, message: payload.note || undefined,
          riderId: payload.user_id, riderName: payload.name, dedupeKey: `refuel:${payload.refill_id}`,
        });
      });

      listen('vehicle:breakdownReported', (payload: any) => {
        if (payload?.user_id && payload?.name) {
          setBreakdownRiderId(payload.user_id);
          breakdownRiderIdRef.current = payload.user_id;
          setBreakdownRiderName(payload.name);
          setBreakdownVehicleModel(payload.vehicle_model || '');
          setBreakdownPlateNumber(payload.plate_number || '');
          setBreakdownReason(payload.reason || 'other');
          setBreakdownNote(payload.note || '');
          setBreakdownActive(true);
          addRideAlert({
            id: `breakdown:${payload.breakdown_id}`, type: 'BREAKDOWN', severity: 'warning', timestamp: payload.reported_at || Date.now(),
            title: `${payload.name} reported a breakdown`, message: payload.note || payload.reason?.replace(/_/g, ' '),
            riderId: payload.user_id, riderName: payload.name,
            vehicleModel: payload.vehicle_model, plateNumber: payload.plate_number,
            dedupeKey: `breakdown:${payload.breakdown_id}`,
          });
        }
      });

      listen('vehicle:breakdownResolved', (payload: any) => {
        if (payload?.user_id && payload.user_id === breakdownRiderIdRef.current) {
          setBreakdownActive(false);
          setBreakdownRiderId('');
          breakdownRiderIdRef.current = '';
          addRideAlert({
            id: `breakdown-resolved:${payload.breakdown_id}`, type: 'BREAKDOWN_RESOLVED', severity: 'info', timestamp: payload.resolved_at || Date.now(),
            title: `${payload.name} resolved their breakdown`, riderId: payload.user_id, riderName: payload.name,
            dedupeKey: `breakdown-resolved:${payload.breakdown_id}`,
          });
        }
      });

      listen('group:separationAlert', (payload: any) => {
        setSeparationsByRider((prev) => recordSeparation(prev, payload));
        const rider = payload?.separated_rider;
        if (rider?.user_id && rider?.name) {
          const distance = formatDistanceMeters(rider.distance_from_nearest_meters);
          const groupSpeed = formatSpeedKph(payload?.group_recommendation?.recommended_speed);
          addRideAlert({
            id: `separation:${rider.user_id}:${payload.timestamp || Date.now()}`,
            type: 'SEPARATION', severity: 'warning', timestamp: payload.timestamp || Date.now(),
            title: `${rider.name} is separated`,
            message: [distance && `${distance} from the nearest rider`, groupSpeed && `Suggested group speed: ${groupSpeed}`].filter(Boolean).join('\n') || undefined,
            riderId: rider.user_id, riderName: rider.name,
            vehicleModel: rider.vehicle_model, plateNumber: rider.plate_number,
            dedupeKey: `separation:${rider.user_id}`,
          });
        }
      });

      listen('group:reunited', (payload: any) => {
        setSeparationsByRider((prev) => clearRiderSeparation(prev, payload?.user_id));
        if (payload?.user_id && payload?.name) addRideAlert({
          id: `reunion:${payload.user_id}:${payload.timestamp || Date.now()}`,
          type: 'REUNION', severity: 'info', timestamp: payload.timestamp || Date.now(),
          title: `${payload.name} reunited with the group`, riderId: payload.user_id, riderName: payload.name,
          dedupeKey: `reunion:${payload.user_id}`,
        });
      });

      listen('ride:started', (payload: any) => {
        if (payload?.group_code) {
          setRideStarted(true);
          setScreen('map');
          addRideAlert({
            id: `ride-started:${payload.group_code}:${payload.started_at || Date.now()}`,
            type: 'RIDE_STARTED', severity: 'info', timestamp: payload.started_at || Date.now(),
            title: 'Ride started', dedupeKey: `ride-started:${payload.group_code}`,
          });
        }
      });

      listen('sos:broadcast', (payload: any) => {
        if (payload?.name && payload?.user_id) {
          addRideAlert({
            id: `sos:${payload.alarm_no}`, type: 'SOS', severity: 'critical', timestamp: payload.timestamp || Date.now(),
            title: 'Emergency SOS', riderId: payload.user_id, riderName: payload.name,
            vehicleModel: payload.vehicle_model, plateNumber: payload.plate_number,
            message: 'An emergency SOS was received. Use Ride Controls for persistent ride information.',
            dedupeKey: `sos:${payload.alarm_no}`,
          });
        }
      });

      // The server emits session:joined before acknowledging session:join, so
      // listeners must be in place before issuing the join/rejoin request.
      if (roomCode) {
        if (reconnecting) console.log('[REJOIN AFTER RECONNECT]');
        console.log('[JOINING SESSION]');
        socketRef.current.joinSession(roomCode).then(() => {
          console.log('[SESSION JOINED]');
          if (reconnecting) {
            console.log('[REJOIN AFTER RECONNECT] success');
            resendLocationAfterReconnect(roomCode);
          } else {
            emitLocationAfterJoinWithFallback(roomCode);
          }
        }).catch((err: any) => {
          console.warn('[SESSION JOIN FAILED]');
          setConnection('offline');
        });
      }
    });

    const unsubscribeDisconnect = socketRef.current.onDisconnect(() => {
      console.log('[SOCKET DIAG] [APP_ONDISCONNECT]');
      setConnection('offline');
      reconnectingRef.current = true;
    });
    console.log('[SOCKET EFFECT START]');
    socketRef.current.connect(API_BASE_URL, authToken).catch(() => setConnection('offline'));

    return () => {
      console.log('[SOCKET DIAG] [APP_EFFECT_CLEANUP]');
      unsubscribeConnect();
      unsubscribeDisconnect();
      // Clean up all event listeners
      for (const cleanup of eventCleanupsRef.current) cleanup();
      eventCleanupsRef.current = [];
      socketRef.current.disconnect();
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !fineLocationGranted || !activeRoomCode || !rideStarted) return;
    console.log('[ACTIVE RIDE -> START GPS]');

    // Reset live stats accumulator when ride (re)starts
    const acc = new RideMetricsAccumulator(Date.now());
    metricsAccumulatorRef.current = acc;
    setLiveMetrics(acc.snapshot());

    telemetryModuleRef.current.start({
      socketUrl: API_BASE_URL,
      authToken,
      groupCode: activeRoomCode,
      healthEndpointUrl: `${API_BASE_URL}/api/health`,
    }).catch(() => {});

    return () => {
      console.warn('[TELEMETRY STOP] context=App active ride lifecycle');
      telemetryModuleRef.current.stop().catch(() => {});
    };
  }, [authToken, fineLocationGranted, activeRoomCode, rideStarted]);

  // Joining a room is a session operation, not a connection operation. Keeping
  // it separate prevents a room-code state update from disconnecting GPS and
  // tearing down the Socket.IO client while other riders are already online.
  useEffect(() => {
    if (!authToken || !activeRoomCode || !socketRef.current.isConnected()) return;
    socketRef.current.joinSession(activeRoomCode)
      .then(() => emitLocationAfterJoinWithFallback(activeRoomCode))
      .catch((err: any) => {
        console.warn('[SESSION JOIN FAILED]');
        setConnection('offline');
      });
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

  const handleLoginSuccess = (
    token: string,
    userData: { id: string; name: string; email: string; username?: string; profile_complete: boolean; vehicle_model?: string; plate_number?: string; vehicle_color?: string }
  ) => {
    setSeparationsByRider(clearAllSeparations());
    setRideAlertState(clearRideAlerts());
    setAuthToken(token);
    setUserId(userData.id);
    setRiderName(userData.name);
    setRiderEmail(userData.email);
    setProfile(prev => ({ ...prev, username: userData.username || '', vehicleModel: userData.vehicle_model || '', plateNumber: userData.plate_number || '', vehicleColor: userData.vehicle_color || '' }));
    setHasCompletedRegistration(userData.profile_complete !== false);
    setScreen(userData.profile_complete === false ? 'registration' : 'portal');
    saveSession(token).catch(() => {});
    void fetch(`${API_BASE_URL}/api/users/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(body => body?.profile && setProfile(prev => ({ ...prev,
        username: body.profile.username || '',
        vehicleModel: body.profile.vehicle_model || '',
        plateNumber: body.profile.plate_number || '',
        vehicleColor: body.profile.vehicle_color || '',
      })))
      .catch(() => console.warn('[PROFILE HYDRATE] vehicle profile unavailable'));
    void fetch(`${API_BASE_URL}/api/users/medical-info`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        if (!response.ok) throw new Error(`Medical profile request failed (${response.status})`);
        return response.json();
      })
      .then(body => {
        const medical = body.medical_info;
        if (!medical) return;
        const emergencyContact = [medical.emergency_contact_name, medical.emergency_contact_phone].filter(Boolean).join(' ');
        setProfile(prev => ({ ...prev,
          bloodGroup: medical.blood_group || 'Skip / Unknown',
          allergies: medical.allergies || '',
          emergencyContact,
          medicalNotes: medical.notes || '',
        }));
      })
      .catch(() => console.warn('[PROFILE HYDRATE] unavailable'));
  };

  const handleRegistrationComplete = async (data: RegistrationData) => {
    setHasCompletedRegistration(true);
    setRiderName(data.fullName);
    setRiderEmail(data.email);
    setProfile(prev => ({
      ...prev,
      username: data.username,
      vehicleModel: data.vehicleModel,
      plateNumber: data.plateNumber,
      vehicleColor: data.vehicleColor,
      emergencyContact: data.emergencyContact,
    }));
    // After registration, auto-login with the new credentials
    try {
      const loginUrl = `${API_BASE_URL}/api/auth/login`;
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email.toLowerCase().trim(), password: data.password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Auto-login after registration failed');
      handleLoginSuccess(body.token, body.user);
    } catch (error) {
      Alert.alert('Registration successful', 'Please sign in with your new account.');
      setScreen('login');
    }
  };

  const handleCreatedRoomStart = (roomData: CreatedRoomData) => {
    setActiveRoomId(roomData.roomId);
    setActiveRoomCode(roomData.groupCode);
    setDestinationTitle(roomData.destination.title);
    const dest = {
      latitude: roomData.destination.latitude,
      longitude: roomData.destination.longitude,
      label: roomData.destination.title,
    };
    setDestination(dest);
    // Update route tracker and dead-end detector with new destination
    routeTrackerRef.current?.setDestination(dest);
    setActiveRoute(null);
    deadEndDetectorRef.current?.setDestination(dest);
    setRouteProgress(null);
    setDeadEndState(DEAD_END_STATE_CLEAR);
    setRoomMembers([]);
    setSeparationsByRider(clearAllSeparations());
    setRideAlertState(clearRideAlerts());
    setIsHost(true);
    setDeviceRole('HOST');
    setRideStarted(false);
    console.log('[RIDE ROOM CREATED]');
    setScreen('map');
    persistActiveRide({
      groupCode: roomData.groupCode, userId, riderName, isHost: true,
      destinationTitle: roomData.destination.title,
      destination: { latitude: roomData.destination.latitude, longitude: roomData.destination.longitude, label: roomData.destination.title },
    });
  };

  const handleJoinedRoomConfirm = (preview: RoomPreviewDetails) => {
    setActiveRoomCode(preview.groupCode);
    setDestinationTitle(preview.destinationTitle);
    if (preview.destination) {
      const dest = {
        latitude: preview.destination.latitude,
        longitude: preview.destination.longitude,
        label: preview.destination.label || preview.destinationTitle,
      };
      setDestination(dest);
      routeTrackerRef.current?.setDestination(dest);
      setActiveRoute(null);
      deadEndDetectorRef.current?.setDestination(dest);
    } else {
      routeTrackerRef.current?.setDestination(null);
      setActiveRoute(null);
      deadEndDetectorRef.current?.setDestination(null);
    }
    setRouteProgress(null);
    setDeadEndState(DEAD_END_STATE_CLEAR);
    setRoomMembers([]);
    setSeparationsByRider(clearAllSeparations());
    setRideAlertState(clearRideAlerts());
    setIsHost(false);
    setDeviceRole('RIDER');
    setRideStarted(false);
    console.log('[RIDE ROOM JOINED]');
    setScreen('map');
    persistActiveRide({
      groupCode: preview.groupCode, userId, riderName, isHost: false,
      destinationTitle: preview.destinationTitle,
      destination: preview.destination ? { latitude: preview.destination.latitude, longitude: preview.destination.longitude, label: preview.destination.label || preview.destinationTitle } : null,
    });
  };

  const handleEndRide = () => {
    if (!isHost || !socketRef.current.isConnected() || endRideInFlightRef.current) return;
    console.log('[END RIDE CLICK]');
    endRideInFlightRef.current = true;
    try {
      socketRef.current.emitWithAck('ride:end', (response: any) => {
        endRideInFlightRef.current = false;
        console.log(`[RIDE END ACK] ${response?.success ? 'success' : 'failed'}`);
        if (response?.error) Alert.alert('Could not end ride', response.error);
      });
    } catch (error) {
      endRideInFlightRef.current = false;
      Alert.alert('Could not end ride', error instanceof Error ? error.message : 'Unable to reach the server.');
    }
  };

  const handleLeaveRoom = () => {
    if (isHost) {
      Alert.alert('Host cannot leave', 'End the ride to close the group for all riders.');
      return;
    }
    if (leaveRideInFlightRef.current) return;
    if (!socketRef.current.isConnected()) {
      Alert.alert('Not connected', 'Reconnect before leaving the ride.');
      return;
    }
    console.warn('[SESSION LEAVE DIAG] App leave pressed');
    leaveRideInFlightRef.current = true;
    try {
      socketRef.current.emitWithAck('session:leave', (response: any) => {
        leaveRideInFlightRef.current = false;
        if (response?.error) {
          Alert.alert('Could not leave ride', response.error);
          return;
        }
        void clearActiveRideState();
      });
    } catch (error) {
      leaveRideInFlightRef.current = false;
      Alert.alert('Could not leave ride', error instanceof Error ? error.message : 'Unable to reach the server.');
    }
  };

  const handleSendRefuelAlert = (payload: RefuelAlertPayload) => {
    try {
      socketRef.current.emitEvent('refill:requested', {
        group_code: activeRoomCode,
        note: payload.note || undefined,
      });
      setShowRefuelModal(false);
    } catch (error) {
      Alert.alert('Refill request failed', error instanceof Error ? error.message : 'Reconnect and try again.');
    }
  };

  const handleStartRide = () => {
    if (startRideInFlightRef.current) {
      console.log('[RIDE START DIAG] duplicate press ignored');
      return;
    }
    if (!activeRoomCode) {
      Alert.alert('No room', 'You are not in a ride room.');
      return;
    }

    if (!socketRef.current.isConnected()) {
      Alert.alert('Not connected', 'Reconnect and try again.');
      return;
    }

    try {
      startRideInFlightRef.current = true;
      setIsStartingRide(true);
      socketRef.current.emitWithAck('ride:start', (response: any) => {
        startRideInFlightRef.current = false;
        setIsStartingRide(false);
        if (response?.error) {
          Alert.alert('Could not start ride', response.error);
        }
      });
    } catch (err: any) {
      startRideInFlightRef.current = false;
      setIsStartingRide(false);
      Alert.alert('Start failed', 'Could not reach server: ' + (err?.message || 'unknown error'));
    }
  };

  const areLocationPermissionsGranted = async (): Promise<boolean> => {
    try {
      const fgPermission = Platform.OS === 'ios'
        ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE
        : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;
      const bgPermission = Platform.OS === 'ios'
        ? PERMISSIONS.IOS.LOCATION_ALWAYS
        : PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION;

      const fgResult = await check(fgPermission);
      if (fgResult !== RESULTS.GRANTED) return false;

      const bgResult = await check(bgPermission);
      return bgResult === RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  const cancelCrashCountdown = () => {
    countdown.cancel();
    if (socketRef.current.isConnected()) socketRef.current.emitEvent('crash:cancelled');
    setScreen('map');
  };

  const triggerBreakdownReport = (reason: BreakdownReason, note: string) => {
    if (socketRef.current.isConnected()) {
      socketRef.current.emitEvent('vehicle:breakdown', { reason, note });
    }
    setBreakdownReason(reason);
    setBreakdownNote(note);
    setBreakdownRiderName(`${riderName} (You)`);
    setBreakdownVehicleModel(profile.vehicleModel);
    setBreakdownPlateNumber(profile.plateNumber);
    setBreakdownRiderId('self');
    breakdownRiderIdRef.current = 'self';
    setBreakdownActive(true);
    setShowReasonModal(false);
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.ink} />

      {!restoringRide && screen === 'login' && (
        <LoginScreen
          apiBaseUrl={API_BASE_URL}
          onLoginSuccess={handleLoginSuccess}
          onNavigateToRegister={() => setScreen('registration')}
        />
      )}

      {screen === 'registration' && (
        <RegistrationGateScreen
          initialData={{
            fullName: riderName,
            username: profile.username,
            email: riderEmail,
            vehicleModel: profile.vehicleModel,
            plateNumber: profile.plateNumber,
            vehicleColor: profile.vehicleColor,
            emergencyContact: profile.emergencyContact,
          }}
          apiBaseUrl={API_BASE_URL}
          isOnline={connection === 'live'}
          onCancel={() => setScreen('login')}
          onCompleteRegistration={handleRegistrationComplete}
        />
      )}

      {screen === 'portal' && (
        <Portal
          riderName={riderName}
          connection={connection}
          profile={profile}
          onCreateRide={async () => {
            setPermissionIntent('create');
            const granted = await areLocationPermissionsGranted();
            if (granted) {
              setScreen('create_destination');
              setPermissionIntent(null);
            } else {
              setScreen('permission_gate');
            }
          }}
          onJoinRide={async () => {
            setPermissionIntent('join');
            const granted = await areLocationPermissionsGranted();
            if (granted) {
              setScreen('join');
              setPermissionIntent(null);
            } else {
              setScreen('permission_gate');
            }
          }}
          onOpenProfile={() => setScreen('profile')}
          onOpenFriends={() => setScreen('friends')}
          onLogout={handleLogout}
        />
      )}

      {screen === 'permission_gate' && (
        <PermissionGate
          onFineLocationGranted={() => setFineLocationGranted(true)}
          onPermissionsGranted={() => {
            if (permissionIntent === 'create') {
              setScreen('create_destination');
            } else if (permissionIntent === 'join') {
              setScreen('join');
            }
            setPermissionIntent(null);
          }}
          onCancel={() => {
            setScreen('portal');
            setPermissionIntent(null);
          }}
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
          onUsernameChanged={username => setProfile(current => ({ ...current, username }))}
          onCancel={() => setScreen('portal')}
        />
      )}

      {screen === 'friends' && (
        <FriendsScreen apiBaseUrl={API_BASE_URL} authToken={authToken} refreshSignal={friendsRefreshSignal} onBack={() => setScreen('portal')} />
      )}

      {screen === 'map' && (() => {
        const computedRiders = roomMembers.map((m) => ({
          user_id: m.user_id,
          name: m.name,
          vehicleModel: m.vehicleModel,
          plateNumber: m.plateNumber,
          lastUpdatedAt: m.lastUpdatedAt,
          latitude: m.isYou || m.name === riderName ? (currentLocation?.latitude ?? 0) : (m.latitude ?? 0),
           longitude: m.isYou || m.name === riderName ? (currentLocation?.longitude ?? 0) : (m.longitude ?? 0),
           isYou: m.isYou || m.name === riderName,
           connectionState: m.isYou || m.name === riderName ? 'CONNECTED' : m.connectionState,
           locationFreshness: m.isYou || m.name === riderName ? 'FRESH' : m.locationFreshness,
        }));
        const peerMarkers = computedRiders.filter(r => !r.isYou && (r.latitude !== 0 || r.longitude !== 0));
        console.log(`[LIVE LOCATION DIAG] [BOUNDARY-G] riders prop | role=${deviceRole} totalMembers=${roomMembers.length} totalRiders=${computedRiders.length} peerMarkersVisible=${peerMarkers.length}`);
        computedRiders.forEach(r => {
          console.log('[MAP RIDER RENDERED]');
        });
        return (
        <MapScreen
          roomCode={activeRoomCode}
          roomId={activeRoomId || undefined}
          apiBaseUrl={API_BASE_URL}
          authToken={authToken}
          isPaused={isPaused}
          destinationTitle={destinationTitle}
          currentLocation={currentLocation}
          riders={computedRiders}
          destination={destination}
          onOpenControls={() => setScreen('controls')}
          onEndRide={handleEndRide}
          isHost={isHost}
          rideStarted={rideStarted}
          members={roomMembers.map((m) => ({
            user_id: m.user_id,
            name: m.name,
            role: m.role,
            vehicleModel: m.vehicleModel,
            plateNumber: m.plateNumber,
            isYou: m.isYou || m.name === riderName,
            connectionState: m.isYou || m.name === riderName
              ? (connection === 'live' ? 'CONNECTED' : 'DISCONNECTED')
              : m.connectionState,
            locationFreshness: m.isYou || m.name === riderName
              ? (connection === 'live' ? 'FRESH' : 'STALE')
              : m.locationFreshness,
            rideState: m.rideState,
          }))}
          onStartRide={isHost ? handleStartRide : undefined}
          isStartingRide={isStartingRide}
          onLeaveRoom={handleLeaveRoom}
          rideAlertState={rideAlertState}
          onDismissRideAlert={dismissActiveRideAlert}
          onWeatherAdvisory={handleWeatherAdvisory}
           liveMetrics={liveMetrics}
           routeProgress={routeProgress}
           deadEndState={deadEndState}
           onDismissDeadEnd={() => deadEndDetectorRef.current?.dismiss()}
           activeRoute={activeRoute}
           onActiveRouteChanged={handleActiveRouteChanged}
        />
        );
      })()}

      {screen === 'controls' && (
        <RideControlsScreen
          roomCode={activeRoomCode}
          riderName={riderName}
          currentUserId={userId}
          connection={connection}
          roomMembers={roomMembers}
          refuelActive={refuelActive}
          refuelRiderName={refuelRiderName}
          refuelNote={refuelNote}
          breakdownActive={breakdownActive}
          breakdownReason={breakdownReason}
          breakdownNote={breakdownNote}
          breakdownRiderName={breakdownRiderName}
          breakdownVehicleModel={breakdownVehicleModel}
          breakdownPlateNumber={breakdownPlateNumber}
          separationsByRider={separationsByRider}
          apiBaseUrl={API_BASE_URL}
          authToken={authToken}
          isPaused={isPaused}
          isPausing={isPauseActionPending}
          onTogglePause={handleTogglePause}
          onClose={() => setScreen('map')}
          onOpenRefuelModal={() => setShowRefuelModal(true)}
          onResolveRefuel={() => setRefuelActive(false)}
          onOpenBreakdownModal={() => setShowReasonModal(true)}
          onResolveBreakdown={() => {
            if (socketRef.current.isConnected()) {
              socketRef.current.emitEvent('vehicle:breakdownResolved');
            }
            setBreakdownActive(false);
            setBreakdownRiderId('');
            breakdownRiderIdRef.current = '';
            setBreakdownVehicleModel('');
            setBreakdownPlateNumber('');
          }}
          onOpenProfile={() => setScreen('profile')}
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

      {screen === 'summary' && completedRideSummaryContext && authToken && (
        <RideSummaryScreen
          groupCode={completedRideSummaryContext.groupCode}
          authToken={authToken}
          apiBaseUrl={API_BASE_URL}
          onReturnToPortal={() => {
            setCompletedRideSummaryContext(null);
            setScreen('portal');
          }}
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

// Login component removed - replaced with LoginScreen.tsx

function Portal({
  riderName,
  connection,
  profile,
  onCreateRide,
  onJoinRide,
  onOpenProfile,
  onOpenFriends,
  onLogout,
}: {
  riderName: string;
  connection: Connection;
  profile: RiderProfileData;
  onCreateRide: () => void | Promise<void>;
  onJoinRide: () => void | Promise<void>;
  onOpenProfile: () => void;
  onOpenFriends: () => void;
  onLogout: () => void;
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
          <Pressable onPress={onLogout} style={styles.profileBadgeBtn}>
            <Text style={styles.profileBadgeBtnText}>Logout</Text>
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Friends</Text>
          <Text style={styles.copy}>Coordinate rides with trusted friends. This never shares your location automatically.</Text>
          <Button label="Manage friends →" tone="secondary" onPress={onOpenFriends} />
        </View>

        {/* JOIN RIDE CARD */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Join a group ride</Text>
          <Text style={styles.copy}>Enter a 6-character room code or open a shared invite link.</Text>
          <Button label="Join ride with group code / link →" tone="secondary" onPress={onJoinRide} />
        </View>

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
  linkButton: { alignSelf: 'center', padding: 8 },
  linkButtonText: { color: COLORS.blue, fontSize: 13, fontWeight: '700' },
});

export default App;
