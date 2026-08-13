module.exports = {
  accelerometer: {
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  },
  gyroscope: {
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  },
  setUpdateIntervalForType: jest.fn(),
  SensorTypes: {
    accelerometer: 'accelerometer',
    gyroscope: 'gyroscope',
  },
};
