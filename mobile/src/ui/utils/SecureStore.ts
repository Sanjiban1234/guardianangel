import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';

const BIOMETRIC_CREDENTIAL_KEY = '@guardianangel/biometric-credential-id';
const LEGACY_KEYS = [
  '@guardianangel:biometric_email',
  '@guardianangel:biometric_password',
  '@guardianangel:biometric_enabled',
  'BIOMETRIC_PASSWORD',
] as const;

export type BiometricCredential = { credentialId: string };

/** Removes passwords left behind by releases that predate GA-01. */
export async function clearLegacyBiometricCredentials(): Promise<void> {
  await AsyncStorage.removeMany([...LEGACY_KEYS]);
}

export async function loadBiometricCredential(): Promise<BiometricCredential | null> {
  await clearLegacyBiometricCredentials();
  const raw = await AsyncStorage.getItem(BIOMETRIC_CREDENTIAL_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'credentialId' in parsed) {
      const credentialId = parsed.credentialId;
      if (typeof credentialId === 'string' && credentialId.length > 0) return { credentialId };
    }
  } catch {
    // An invalid identifier cannot authenticate and is removed below.
  }
  await AsyncStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
  return null;
}

/** Stores only a non-secret server credential identifier; the signing key stays in Android Keystore. */
export async function saveBiometricCredential(credential: BiometricCredential): Promise<void> {
  await clearLegacyBiometricCredentials();
  await AsyncStorage.setItem(BIOMETRIC_CREDENTIAL_KEY, JSON.stringify(credential));
}

export async function clearBiometricLogin(): Promise<void> {
  await AsyncStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
  await clearLegacyBiometricCredentials();
  try {
    await new ReactNativeBiometrics().deleteKeys();
  } catch {
    // The local identifier is already gone; a missing/invalidated native key is safe.
  }
}
