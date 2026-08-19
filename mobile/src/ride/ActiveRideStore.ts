import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_RIDE_KEY = '@guardianangel/active-ride';
const SESSION_KEY = '@guardianangel/session';

export type ActiveRideRecovery = {
  groupCode: string;
  userId: string;
  riderName: string;
  isHost: boolean;
  destinationTitle: string;
  destination: { latitude: number; longitude: number; label: string } | null;
};

export async function saveSession(token: string): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, token);
}

export async function loadSession(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_KEY);
}

export async function saveActiveRide(ride: ActiveRideRecovery): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_RIDE_KEY, JSON.stringify(ride));
}

export async function loadActiveRide(): Promise<ActiveRideRecovery | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_RIDE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ActiveRideRecovery;
    if (value?.groupCode && value?.userId) return value;
  } catch {
    // Fall through and remove the unusable persisted recovery record.
  }
  await AsyncStorage.removeItem(ACTIVE_RIDE_KEY);
  return null;
}

export async function clearActiveRide(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_RIDE_KEY);
}
