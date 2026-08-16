/**
 * Secure storage utility for biometric authentication credentials.
 *
 * Uses @react-native-async-storage/async-storage for persistence across app restarts.
 * Credentials are only accessible after successful biometric authentication
 * (enforced by the caller via react-native-biometrics simplePrompt/createSignature).
 *
 * Security model:
 * - Email (non-sensitive identifier) stored in AsyncStorage to remember who enabled biometrics
 * - Password stored in AsyncStorage (encrypted at rest by Android's file-based encryption)
 * - Access to credentials is gated by biometric authentication in the calling code
 * - Biometric keys are managed via react-native-biometrics (Android Keystore)
 * - On logout or key invalidation, all stored credentials are cleared
 *
 * For maximum security, consider migrating to react-native-keychain which stores
 * credentials directly in the Android Keystore (hardware-backed). This implementation
 * provides a working solution with the currently installed dependencies.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';

const STORAGE_KEYS = {
  BIOMETRIC_EMAIL: '@guardianangel:biometric_email',
  BIOMETRIC_PASSWORD: '@guardianangel:biometric_password',
  BIOMETRIC_ENABLED: '@guardianangel:biometric_enabled',
} as const;

export interface BiometricCredentials {
  email: string;
  password: string;
}

/**
 * Check if biometric login has been set up and keys still exist.
 */
export const isBiometricSetup = async (): Promise<boolean> => {
  try {
    const enabled = await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_ENABLED);
    if (enabled !== 'true') return false;

    // Verify the biometric key still exists in the Keystore
    const rnBiometrics = new ReactNativeBiometrics();
    const { keysExist } = await rnBiometrics.biometricKeysExist();

    if (!keysExist) {
      // Keys were invalidated (e.g., user changed biometric enrollment, app reinstalled)
      // Clean up stale data
      await clearBiometricCredentials();
      return false;
    }

    // Verify we have stored credentials
    const email = await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_EMAIL);
    const password = await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_PASSWORD);
    return !!(email && password);
  } catch (error) {
    console.warn('[SecureStore] Error checking biometric setup:', error);
    return false;
  }
};

/**
 * Store biometric credentials after successful login + biometric enrollment.
 * Also creates biometric keys in the Android Keystore.
 */
export const setBiometricCredentials = async (
  email: string,
  password: string,
): Promise<boolean> => {
  try {
    const rnBiometrics = new ReactNativeBiometrics();

    // Check if keys already exist; if not, create them
    const { keysExist } = await rnBiometrics.biometricKeysExist();
    if (!keysExist) {
      const { publicKey } = await rnBiometrics.createKeys();
      if (!publicKey) {
        console.warn('[SecureStore] Failed to create biometric keys');
        return false;
      }
    }

    // Store credentials in AsyncStorage
    // These are protected by the biometric gate in the calling code
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.BIOMETRIC_EMAIL, email],
      [STORAGE_KEYS.BIOMETRIC_PASSWORD, password],
      [STORAGE_KEYS.BIOMETRIC_ENABLED, 'true'],
    ]);

    return true;
  } catch (error) {
    console.warn('[SecureStore] Error saving biometric credentials:', error);
    return false;
  }
};

/**
 * Retrieve stored biometric credentials.
 * IMPORTANT: The caller MUST verify biometric authentication (via simplePrompt)
 * BEFORE calling this function. This function does not perform biometric verification itself.
 */
export const getBiometricCredentials = async (): Promise<BiometricCredentials | null> => {
  try {
    const enabled = await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_ENABLED);
    if (enabled !== 'true') return null;

    // Verify biometric keys still exist
    const rnBiometrics = new ReactNativeBiometrics();
    const { keysExist } = await rnBiometrics.biometricKeysExist();
    if (!keysExist) {
      // Keys were invalidated — clear stored data
      await clearBiometricCredentials();
      return null;
    }

    const values = await AsyncStorage.multiGet([
      STORAGE_KEYS.BIOMETRIC_EMAIL,
      STORAGE_KEYS.BIOMETRIC_PASSWORD,
    ]);

    const email = values[0]?.[1];
    const password = values[1]?.[1];

    if (!email || !password) {
      return null;
    }

    return { email, password };
  } catch (error) {
    console.warn('[SecureStore] Error retrieving biometric credentials:', error);
    return null;
  }
};

/**
 * Get the email associated with biometric login (for display purposes).
 * Does NOT require biometric authentication.
 */
export const getBiometricEmail = async (): Promise<string | null> => {
  try {
    const enabled = await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_ENABLED);
    if (enabled !== 'true') return null;
    return await AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_EMAIL);
  } catch {
    return null;
  }
};

/**
 * Clear all biometric credentials and delete keys from the Keystore.
 * Called on logout, key invalidation, or when the user disables biometric login.
 */
export const clearBiometricCredentials = async (): Promise<void> => {
  try {
    // Remove stored credentials
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.BIOMETRIC_EMAIL,
      STORAGE_KEYS.BIOMETRIC_PASSWORD,
      STORAGE_KEYS.BIOMETRIC_ENABLED,
    ]);

    // Delete biometric keys from Keystore
    const rnBiometrics = new ReactNativeBiometrics();
    const { keysExist } = await rnBiometrics.biometricKeysExist();
    if (keysExist) {
      await rnBiometrics.deleteKeys();
    }
  } catch (error) {
    console.warn('[SecureStore] Error clearing biometric credentials:', error);
  }
};
