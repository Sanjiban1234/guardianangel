/**
 * Biometric-login migration guard. Older releases incorrectly saved a
 * reusable password in AsyncStorage. This module removes those values and
 * intentionally keeps biometric login disabled until a Keychain/Keystore
 * backed, server-issued token flow is available.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_KEYS = [
  '@guardianangel:biometric_email',
  '@guardianangel:biometric_password',
  '@guardianangel:biometric_enabled',
  'BIOMETRIC_PASSWORD',
] as const;

export interface BiometricCredentials { email: string; password: string; }

export const clearBiometricCredentials = async (): Promise<void> => {
  await AsyncStorage.removeMany([...LEGACY_KEYS]);
};

/** Migration runs on every check so stale passwords are removed. */
export const isBiometricSetup = async (): Promise<boolean> => {
  await clearBiometricCredentials();
  return false;
};

/** Compatibility API: the supplied password is never written. */
export const setBiometricCredentials = async (_email: string, _password: string): Promise<boolean> => {
  await clearBiometricCredentials();
  return false;
};

/** A password can never be retrieved from local storage. */
export const getBiometricCredentials = async (): Promise<BiometricCredentials | null> => {
  await clearBiometricCredentials();
  return null;
};

export const getBiometricEmail = async (): Promise<string | null> => null;
