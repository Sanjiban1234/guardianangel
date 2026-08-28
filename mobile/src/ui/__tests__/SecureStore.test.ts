import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';
import {
  clearBiometricLogin,
  clearLegacyBiometricCredentials,
  loadBiometricCredential,
  saveBiometricCredential,
} from '../utils/SecureStore';

describe('biometric credential storage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('stores only the non-secret server credential identifier and removes legacy passwords', async () => {
    await AsyncStorage.setItem('BIOMETRIC_PASSWORD', 'password-SENTINEL');
    await saveBiometricCredential({ credentialId: 'credential-1' });

    expect(await loadBiometricCredential()).toEqual({ credentialId: 'credential-1' });
    expect(await AsyncStorage.getItem('BIOMETRIC_PASSWORD')).toBeNull();
    expect(await AsyncStorage.getItem('@guardianangel:biometric_password')).toBeNull();
    expect(await AsyncStorage.getAllKeys()).not.toContain('password-SENTINEL');
  });

  it('deletes legacy BIOMETRIC_PASSWORD on every migration check', async () => {
    await AsyncStorage.setItem('BIOMETRIC_PASSWORD', 'legacy-password');
    await clearLegacyBiometricCredentials();
    expect(await AsyncStorage.getItem('BIOMETRIC_PASSWORD')).toBeNull();
  });

  it('clears the local identifier and Keystore key on logout', async () => {
    const deleteKeys = jest.spyOn(ReactNativeBiometrics.prototype, 'deleteKeys');
    await saveBiometricCredential({ credentialId: 'credential-1' });
    await clearBiometricLogin();

    expect(await loadBiometricCredential()).toBeNull();
    expect(deleteKeys).toHaveBeenCalled();
  });
});
