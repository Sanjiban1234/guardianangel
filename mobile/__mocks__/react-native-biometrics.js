/**
 * Mock for react-native-biometrics — the native Keystore bridge is not
 * available in the Jest environment. All methods resolve to no-op success.
 */

class ReactNativeBiometricsMock {
  constructor() {}

  isSensorAvailable() {
    return Promise.resolve({ available: true, biometryType: 'Biometrics' });
  }

  biometricKeysExist() {
    return Promise.resolve({ keysExist: false });
  }

  createKeys() {
    return Promise.resolve({ publicKey: 'mock-public-key' });
  }

  deleteKeys() {
    return Promise.resolve({ keysDeleted: true });
  }

  simplePrompt() {
    return Promise.resolve({ success: true });
  }

  createSignature() {
    return Promise.resolve({ success: true, signature: 'mock-signature' });
  }
}

const BiometryTypes = {
  FACE_ID: 'FaceID',
  TOUCH_ID: 'TouchID',
  BIOMETRICS: 'Biometrics',
};

module.exports = ReactNativeBiometricsMock;
module.exports.default = ReactNativeBiometricsMock;
module.exports.BiometryTypes = BiometryTypes;
module.exports.__esModule = true;
