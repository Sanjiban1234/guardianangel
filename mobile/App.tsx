import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
  loadActiveRide,
  loadSession,
  saveActiveRide,
  saveSession,
} from './src/ride/ActiveRideStore';

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
  const [connection, setConnection] = useState<Connection>('live');
  const [authToken, setAuthToken] = useState('');
  const [fineLocationGranted, setFineLocationGranted] = useState(false);
  const fineLocationGrantedRef = useRef(false);
  const socketRef = useRef(new SocketClient());
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
  const [destinationTitle, setDestinationTitle] = useState<string>('');
  const [roomMembers, setRoomMembers] = useState<Array<{ user_id: string; name: string; role?: string; isYou?: boolean; latitude?: number; longitude?: number }>>([]);
  const [currentLocation, setCurrentLocation] = useState<LatestLocationSnapshot | null>(null);
  const currentLocationRef = useRef<LatestLocationSnapshot | null>(null);
  const postJoinCurrentPositionRef = useRef<Promise<LatestLocationSnapshot> | null>(null);
  const [destination, setDestination] = useState<{ latitude: number; longitude: number; label: string } | null>(null);
  const activeRoomCodeRef = useRef(activeRoomCode);

  useEffect(() => {
    activeRoomCodeRef.current = activeRoomCode;
  }, [activeRoomCode]);

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
  const [breakdownNote, setBreakdownNote] = useState<string>('Rear tire punctured on gravel segment.');
  const [breakdownRiderName, setBreakdownRiderName] = useState<string>('');
  const [breakdownRiderId, setBreakdownRiderId] = useState<string>('');
  const breakdownRiderIdRef = useRef<string>('');
  const [showReasonModal, setShowReasonModal] = useState<boolean>(false);

  // Group separation state
  const [separationActive, setSeparationActive] = useState<boolean>(false);
  const [separationRole, setSeparationRole] = useState<'rider' | 'group'>('rider');
  const [permissionIntent, setPermissionIntent] = useState<'create' | 'join' | null>(null);

  // Ride start state
  const [rideStarted, setRideStarted] = useState<boolean>(false);
  const [isStartingRide, setIsStartingRide] = useState<boolean>(false);
  const startRideInFlightRef = useRef(false);
  const endRideInFlightRef = useRef(false);
  const leaveRideInFlightRef = useRef(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [deviceRole, setDeviceRole] = useState<'HOST' | 'RIDER' | 'UNKNOWN'>('UNKNOWN');
  const reconnectingRef = useRef(false);

  const clearActiveRideState = async () => {
    await clearActiveRide().catch(() => {});
    setActiveRoomCode('');
    setDestinationTitle('');
    setDestination(null);
    setRoomMembers([]);
    setRideStarted(false);
    setIsHost(false);
    setDeviceRole('UNKNOWN');
    endRideInFlightRef.current = false;
    leaveRideInFlightRef.current = false;
    setScreen('portal');
  };

  const persistActiveRide = (ride: ActiveRideRecovery) => {
    saveActiveRide(ride).catch((error) => console.warn('[ACTIVE RIDE RESTORE] persist failed', error));
  };

  // Update current location from telemetry
  useEffect(() => {
    const subscription = telemetryStream$.subscribe((reading) => {
      setCurrentLocation({
        timestamp: reading.timestamp,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy: reading.accuracy,
        speed: reading.speed,
      });
      currentLocationRef.current = {
        timestamp: reading.timestamp,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy: reading.accuracy,
        speed: reading.speed,
      };
    });
    return () => subscription.unsubscribe();
  }, [telemetryStream$]);

  const updateLatestLocation = (location: LatestLocationSnapshot) => {
    currentLocationRef.current = location;
    setCurrentLocation(location);
  };

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
    console.log(`[POST-JOIN LOCATION CACHE MISS] groupCode=${groupCode}`);
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
    console.log(`[POST-JOIN LOCATION CACHE MISS] groupCode=${groupCode}`);
    const location = await getPostJoinCurrentPosition();
    if (location) {
      resendLatestLocationForJoinedMember(socketRef.current, groupCode, riderNameRef.current, payload, location);
    }
  };

  const resendLocationAfterReconnect = async (groupCode: string) => {
    const cachedLocation = currentLocationRef.current;
    if (hasValidLatestLocation(cachedLocation)) {
      console.log(`[RECONNECT LOCATION RESEND] lat=${cachedLocation.latitude.toFixed(6)} lng=${cachedLocation.longitude.toFixed(6)}`);
      emitLatestLocationAfterJoin(socketRef.current, groupCode, cachedLocation);
      return;
    }
    console.log('[RECONNECT LOCATION CACHE MISS]');
    const location = await getPostJoinCurrentPosition();
    if (!location) {
      console.warn('[RECONNECT CURRENT POSITION ERROR] no location available');
      return;
    }
    console.log(`[RECONNECT CURRENT POSITION SUCCESS] lat=${location.latitude.toFixed(6)} lng=${location.longitude.toFixed(6)}`);
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
      console.log(`[ACTIVE RIDE RESTORE] found groupCode=${ride.groupCode}`);
      if (!cancelled) {
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
          console.warn('[ACTIVE RIDE RESTORE] validation unavailable; retaining persisted ride for retry', error);
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
      console.log(`[SOCKET DIAG] [APP_ONCONNECT] role=${deviceRole} activeRoom=${roomCode || 'none'} transport=${transport} riderName=${riderName}`);
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

      listen('session:joined', (payload: any) => {
        console.log(`[LIVE LOCATION AUDIT] session:joined received, members: ${payload?.members?.length ?? 0}`);
        console.log(`[LIVE LOCATION DIAG] [BOUNDARY-F] session:joined received | role=${deviceRole} members=${payload?.members?.length || 0}`);
        if (payload?.members && Array.isArray(payload.members)) {
          setRoomMembers((prev) => {
            const prevMap = new Map(prev.map((m) => [m.user_id, m]));
            return payload.members.map((m: any) => {
              const existing = prevMap.get(m.user_id);
              console.log(`[LIVE LOCATION DIAG]   member: name=${m.name} user_id=${m.user_id} lat=${m.latitude ?? existing?.latitude} lng=${m.longitude ?? existing?.longitude} role=${m.role}`);
              return {
                user_id: m.user_id,
                name: m.name,
                role: m.role,
                isYou: m.name === riderName,
                // Preserve existing coordinates if the server payload has none
                latitude: m.latitude ?? existing?.latitude,
                longitude: m.longitude ?? existing?.longitude,
              };
            });
          });
        }
        if (payload?.ride_started_at) {
          setRideStarted(true);
          setScreen('map');
        }
      });

      listen('session:member_joined', (payload: any) => {
        if (payload?.user_id) {
          setRoomMembers((prev) => {
            if (prev.some((m) => m.user_id === payload.user_id || m.name === payload.name)) return prev;
            return [...prev, { user_id: payload.user_id, name: payload.name, isYou: false }];
          });
          resendLocationForJoinedMemberWithFallback(activeRoomCodeRef.current, payload);
        }
      });

      listen('session:member_left', (payload: any) => {
        if (payload?.user_id) {
          setRoomMembers((prev) => prev.filter((m) => m.user_id !== payload.user_id));
          if (payload?.name) Alert.alert('Ride member left', `${payload.name} left the ride`);
        }
      });
      listen('ride:ended', () => {
        Alert.alert('Ride ended', 'The host ended this ride.');
        void clearActiveRideState();
      });
      listen('location:broadcast', (payload: any) => {
        console.log(`[LIVE LOCATION AUDIT] location:broadcast from ${payload?.name} (${payload?.user_id}) lat=${payload?.latitude} lng=${payload?.longitude}`);
        console.log(`[LIVE LOCATION DIAG] [BOUNDARY-F] location:broadcast | role=${deviceRole} from=${payload?.name}(${payload?.user_id}) lat=${payload?.latitude?.toFixed(6)} lng=${payload?.longitude?.toFixed(6)}`);
        if (payload?.user_id && payload?.name) {
          setRoomMembers((prev) => {
            const existing = prev.find((m) => m.user_id === payload.user_id);
            if (existing) {
              console.log(`[LIVE LOCATION DIAG]   UPDATE: prev had ${prev.length} members, updating user_id=${payload.user_id}`);
              return prev.map((m) =>
                m.user_id === payload.user_id
                  ? { ...m, latitude: payload.latitude, longitude: payload.longitude }
                  : m
              );
            }
            if (payload.name !== riderName) {
              console.log(`[LIVE LOCATION DIAG]   ADD_NEW: prev had ${prev.length} members, adding name=${payload.name}`);
              return [...prev, {
                user_id: payload.user_id,
                name: payload.name,
                isYou: false,
                latitude: payload.latitude,
                longitude: payload.longitude,
              }];
            }
            console.log(`[LIVE LOCATION DIAG]   SKIP: broadcast is from self (name=${payload.name} = riderName=${riderName})`);
            return prev;
          });
        } else {
          console.log(`[LIVE LOCATION DIAG]   INVALID: missing user_id=${payload?.user_id} or name=${payload?.name}`);
        }
      });

      listen('peer:lastKnown', (payload: any) => {
        if (payload?.user_id && payload?.name) {
          setRoomMembers((prev) => {
            const existing = prev.find((m) => m.user_id === payload.user_id);
            if (existing) {
              return prev.map((m) =>
                m.user_id === payload.user_id
                  ? { ...m, latitude: payload.latitude, longitude: payload.longitude }
                  : m
              );
            }
            return [...prev, {
              user_id: payload.user_id,
              name: payload.name,
              isYou: false,
              latitude: payload.latitude,
              longitude: payload.longitude,
            }];
          });
        }
      });

      listen('refill:notified', (payload) => {
        setRefuelRiderName(payload.name);
        setRefuelNote(payload.note || 'Need petrol stop soon.');
        setRefuelActive(true);
      });

      listen('vehicle:breakdownReported', (payload: any) => {
        if (payload?.user_id && payload?.name) {
          setBreakdownRiderId(payload.user_id);
          breakdownRiderIdRef.current = payload.user_id;
          setBreakdownRiderName(payload.name);
          setBreakdownReason(payload.reason || 'other');
          setBreakdownNote(payload.note || '');
          setBreakdownActive(true);
        }
      });

      listen('vehicle:breakdownResolved', (payload: any) => {
        if (payload?.user_id && payload.user_id === breakdownRiderIdRef.current) {
          setBreakdownActive(false);
          setBreakdownRiderId('');
          breakdownRiderIdRef.current = '';
        }
      });

      listen('group:separationAlert', (payload: any) => {
        if (payload?.separated_rider) {
          setSeparationActive(true);
          const isThisUser = payload.separated_rider.name === riderName;
          setSeparationRole(isThisUser ? 'rider' : 'group');
        }
      });

      listen('group:reunited', (payload: any) => {
        if (payload?.user_id) {
          setSeparationActive(false);
          setSeparationRole('rider');
        }
      });

      listen('ride:started', (payload: any) => {
        if (payload?.group_code) {
          setRideStarted(true);
          setScreen('map');
        }
      });

      listen('sos:broadcast', (payload: any) => {
        if (payload?.name && payload?.user_id) {
          Alert.alert(
            'EMERGENCY SOS',
            `${payload.name} has triggered an emergency SOS alert.\n\nLocation: ${payload.latitude?.toFixed(5)}, ${payload.longitude?.toFixed(5)}${payload.medical_info ? '\n\nMedical info attached.' : ''}`,
            [{ text: 'OK' }],
          );
        }
      });

      // The server emits session:joined before acknowledging session:join, so
      // listeners must be in place before issuing the join/rejoin request.
      if (roomCode) {
        if (reconnecting) console.log(`[REJOIN AFTER RECONNECT] groupCode=${roomCode}`);
        console.log(`[LIVE LOCATION AUDIT] Joining session: ${roomCode}`);
        console.log(`[SOCKET DIAG] [APP_JOINING_SESSION] groupCode=${roomCode}`);
        socketRef.current.joinSession(roomCode).then(() => {
          console.log(`[SOCKET DIAG] [APP_SESSION_JOINED_OK] groupCode=${roomCode}`);
          if (reconnecting) {
            console.log('[REJOIN AFTER RECONNECT] success');
            resendLocationAfterReconnect(roomCode);
          } else {
            emitLocationAfterJoinWithFallback(roomCode);
          }
        }).catch((err: any) => {
          console.log(`[SOCKET DIAG] [APP_SESSION_JOIN_FAILED] groupCode=${roomCode} error=${err?.message}`);
          setConnection('offline');
        });
      }
    });

    const unsubscribeDisconnect = socketRef.current.onDisconnect(() => {
      console.log(`[SOCKET DIAG] [APP_ONDISCONNECT] role=${deviceRole} activeRoom=${activeRoomCode || 'none'}`);
      setConnection('offline');
      reconnectingRef.current = true;
    });
    console.log(`[SOCKET DIAG] [APP_EFFECT_START] role=${deviceRole} authToken=${authToken ? 'present' : 'MISSING'}`);
    socketRef.current.connect(API_BASE_URL, authToken).catch(() => setConnection('offline'));

    return () => {
      console.log(`[SOCKET DIAG] [APP_EFFECT_CLEANUP] generation=${effectGeneration} role=${deviceRole} activeRoom=${activeRoomCodeRef.current || 'none'}`);
      unsubscribeConnect();
      unsubscribeDisconnect();
      // Clean up all event listeners
      for (const cleanup of eventCleanupsRef.current) cleanup();
      eventCleanupsRef.current = [];
      socketRef.current.disconnect();
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !fineLocationGranted) return;
    console.log('[LOCATION PERMISSION GRANTED -> START GPS]');
    telemetryModuleRef.current.start({
      socketUrl: API_BASE_URL,
      authToken,
      groupCode: activeRoomCodeRef.current,
      healthEndpointUrl: `${API_BASE_URL}/api/health`,
    }).catch(() => {});

    return () => {
      console.warn('[TELEMETRY STOP] context=App fine-location permission lifecycle');
      telemetryModuleRef.current.stop().catch(() => {});
    };
  }, [authToken, fineLocationGranted]);

  // Joining a room is a session operation, not a connection operation. Keeping
  // it separate prevents a room-code state update from disconnecting GPS and
  // tearing down the Socket.IO client while other riders are already online.
  useEffect(() => {
    if (!authToken || !activeRoomCode || !socketRef.current.isConnected()) return;
    socketRef.current.joinSession(activeRoomCode)
      .then(() => emitLocationAfterJoinWithFallback(activeRoomCode))
      .catch((err: any) => {
        console.log(`[SOCKET DIAG] [APP_SESSION_JOIN_FAILED] groupCode=${activeRoomCode} error=${err?.message}`);
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
    userData: { id: string; name: string; email: string; profile_complete: boolean }
  ) => {
    setAuthToken(token);
    setUserId(userData.id);
    setRiderName(userData.name);
    setRiderEmail(userData.email);
    setHasCompletedRegistration(userData.profile_complete !== false);
    setScreen(userData.profile_complete === false ? 'registration' : 'portal');
    saveSession(token).catch(() => {});
  };

  const handleRegistrationComplete = async (data: RegistrationData) => {
    setHasCompletedRegistration(true);
    setRiderName(data.fullName);
    setRiderEmail(data.email);
    setProfile(prev => ({
      ...prev,
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
    setActiveRoomCode(roomData.groupCode);
    setDestinationTitle(roomData.destination.title);
    setDestination({
      latitude: roomData.destination.latitude,
      longitude: roomData.destination.longitude,
      label: roomData.destination.title,
    });
    setRoomMembers([]);
    setIsHost(true);
    setDeviceRole('HOST');
    setRideStarted(false);
    console.log(`[LIVE LOCATION DIAG] handleCreatedRoomStart | role=HOST groupCode=${roomData.groupCode}`);
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
      setDestination({
        latitude: preview.destination.latitude,
        longitude: preview.destination.longitude,
        label: preview.destination.label || preview.destinationTitle,
      });
    }
    setRoomMembers([]);
    setIsHost(false);
    setDeviceRole('RIDER');
    setRideStarted(false);
    console.log(`[LIVE LOCATION DIAG] handleJoinedRoomConfirm | role=RIDER groupCode=${preview.groupCode}`);
    setScreen('map');
    persistActiveRide({
      groupCode: preview.groupCode, userId, riderName, isHost: false,
      destinationTitle: preview.destinationTitle,
      destination: preview.destination ? { latitude: preview.destination.latitude, longitude: preview.destination.longitude, label: preview.destination.label || preview.destinationTitle } : null,
    });
  };

  const handleEndRide = () => {
    if (!isHost || !socketRef.current.isConnected() || endRideInFlightRef.current) return;
    endRideInFlightRef.current = true;
    try {
      socketRef.current.emitWithAck('ride:end', (response: any) => {
        endRideInFlightRef.current = false;
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
    console.warn(`[SESSION LEAVE DIAG] App leave pressed | room=${activeRoomCode} connected=true`);
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
        note: payload.note || 'Need petrol stop soon.',
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
          onCancel={() => setScreen('portal')}
        />
      )}

      {screen === 'map' && (() => {
        const computedRiders = roomMembers.map((m) => ({
          user_id: m.user_id,
          name: m.name,
          latitude: m.isYou || m.name === riderName ? (currentLocation?.latitude ?? 0) : (m.latitude ?? 0),
          longitude: m.isYou || m.name === riderName ? (currentLocation?.longitude ?? 0) : (m.longitude ?? 0),
          isYou: m.isYou || m.name === riderName,
        }));
        const peerMarkers = computedRiders.filter(r => !r.isYou && (r.latitude !== 0 || r.longitude !== 0));
        console.log(`[LIVE LOCATION DIAG] [BOUNDARY-G] riders prop | role=${deviceRole} totalMembers=${roomMembers.length} totalRiders=${computedRiders.length} peerMarkersVisible=${peerMarkers.length}`);
        computedRiders.forEach(r => {
          console.log(`[LIVE LOCATION DIAG]   rider: name=${r.name} isYou=${r.isYou} lat=${r.latitude.toFixed(6)} lng=${r.longitude.toFixed(6)}`);
        });
        return (
        <MapScreen
          roomCode={activeRoomCode}
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
            isYou: m.isYou || m.name === riderName,
          }))}
          onStartRide={isHost ? handleStartRide : undefined}
          isStartingRide={isStartingRide}
          onLeaveRoom={handleLeaveRoom}
        />
        );
      })()}

      {screen === 'controls' && (
        <RideControlsScreen
          roomCode={activeRoomCode}
          riderName={riderName}
          connection={connection}
          roomMembers={roomMembers}
          refuelActive={refuelActive}
          refuelRiderName={refuelRiderName}
          refuelNote={refuelNote}
          breakdownActive={breakdownActive}
          breakdownReason={breakdownReason}
          breakdownNote={breakdownNote}
          breakdownRiderName={breakdownRiderName}
          separationActive={separationActive}
          separationRole={separationRole}
          profile={profile}
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

      {screen === 'summary' && activeRoomCode && authToken && (
        <RideSummaryScreen
          groupCode={activeRoomCode}
          authToken={authToken}
          apiBaseUrl={API_BASE_URL}
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

// Login component removed - replaced with LoginScreen.tsx

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
  onCreateRide: () => void | Promise<void>;
  onJoinRide: () => void | Promise<void>;
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
