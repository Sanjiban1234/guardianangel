module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^react-native-sensors$': '<rootDir>/__mocks__/react-native-sensors.js',
    '^@react-native-community/geolocation$': '<rootDir>/__mocks__/react-native-community-geolocation.js',
    '^@react-native-clipboard/clipboard$': '<rootDir>/__mocks__/@react-native-clipboard/clipboard.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|react-native-maps|react-native-safe-area-context|@react-native-async-storage/async-storage)/',
  ],
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
};

