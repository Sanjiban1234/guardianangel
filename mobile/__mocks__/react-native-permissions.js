/**
 * Mock for react-native-permissions — the native permission bridge is not
 * available in the Jest environment. All checks/requests resolve to 'granted'.
 */

const granted = 'granted';

module.exports = {
  __esModule: true,
  check: () => Promise.resolve(granted),
  checkMultiple: () => Promise.resolve({}),
  request: () => Promise.resolve(granted),
  requestMultiple: () => Promise.resolve({}),
  openSettings: () => Promise.resolve(),
  PERMISSIONS: {
    ANDROID: {
      ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
      ACCESS_BACKGROUND_LOCATION: 'android.permission.ACCESS_BACKGROUND_LOCATION',
      ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
    },
    IOS: {
      LOCATION_WHEN_IN_USE: 'ios.permission.LOCATION_WHEN_IN_USE',
      LOCATION_ALWAYS: 'ios.permission.LOCATION_ALWAYS',
    },
  },
  RESULTS: {
    GRANTED: granted,
    DENIED: 'denied',
    BLOCKED: 'blocked',
    LIMITED: 'limited',
    UNAVAILABLE: 'unavailable',
  },
};
