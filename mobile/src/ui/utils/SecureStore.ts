/**
 * Secure storage utility for biometric authentication credentials.
 * Uses platform-specific secure storage mechanisms.
 */

import { Platform } from 'react-native';

// This is a simple implementation. In production, you should use:
// - @react-native-async-storage/async-storage with encryption
// - react-native-keychain for iOS/Android keychain storage
// - Or expo-secure-store for Expo projects

interface BiometricCredentials {
  email: string;
  token: string;
}

const STORAGE_KEY = '@guardianangel:biometric_creds';

// Mock storage for now - replace with actual secure storage
let mockStorage: BiometricCredentials | null = null;

export const setBiometricCredentials = async (
  email: string,
  token: string
): Promise<void> => {
  try {
    const credentials: BiometricCredentials = { email, token };

    // In production, use react-native-keychain or expo-secure-store:
    // await Keychain.setGenericPassword(email, token, {
    //   service: STORAGE_KEY,
    //   accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    // });

    // For now, using mock storage
    mockStorage = credentials;
  } catch (error) {
    console.error('Error saving biometric credentials:', error);
    throw error;
  }
};

export const getBiometricCredentials = async (): Promise<BiometricCredentials | null> => {
  try {
    // In production, use react-native-keychain or expo-secure-store:
    // const credentials = await Keychain.getGenericPassword({ service: STORAGE_KEY });
    // if (credentials) {
    //   return { email: credentials.username, token: credentials.password };
    // }

    // For now, using mock storage
    return mockStorage;
  } catch (error) {
    console.error('Error retrieving biometric credentials:', error);
    return null;
  }
};

export const clearBiometricCredentials = async (): Promise<void> => {
  try {
    // In production, use react-native-keychain or expo-secure-store:
    // await Keychain.resetGenericPassword({ service: STORAGE_KEY });

    // For now, using mock storage
    mockStorage = null;
  } catch (error) {
    console.error('Error clearing biometric credentials:', error);
    throw error;
  }
};
