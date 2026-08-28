import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

const mockTelemetryStop = jest.fn(async () => {});
const mockSocketDisconnect = jest.fn();
const mockSocketEmitWithAck = jest.fn();

jest.mock('../src/telemetry', () => ({
  TelemetryModule: jest.fn().mockImplementation(() => ({
    stop: mockTelemetryStop,
    onReading: () => () => {},
  })),
}));

jest.mock('../src/telemetry/location/LocationProvider', () => ({
  CommunityGeolocationProvider: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../src/telemetry/socket/SocketClient', () => ({
  SocketClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(async () => {}),
    disconnect: mockSocketDisconnect,
    isConnected: () => false,
    onConnect: () => () => {},
    onDisconnect: () => () => {},
    onEvent: () => () => {},
    emitEvent: jest.fn(),
    emitWithAck: mockSocketEmitWithAck,
    joinSession: jest.fn(async () => {}),
    emitLocationUpdate: jest.fn(),
    emitBulkSync: jest.fn(),
  })),
}));

jest.mock('../src/ride/ActiveRideStore', () => ({
  loadSession: jest.fn(async () => null),
  loadActiveRide: jest.fn(async () => null),
  clearActiveRide: jest.fn(async () => {}),
  clearSession: jest.fn(async () => {}),
  saveActiveRide: jest.fn(async () => {}),
  saveSession: jest.fn(async () => {}),
}));

jest.mock('../src/ui/utils/SecureStore', () => ({
  clearBiometricLogin: jest.fn(async () => {}),
}));

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function renderAuthenticatedApp(token = 'logout-access-token') {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await flush();
  });

  const login = renderer.root.find(node => typeof node.props.onLoginSuccess === 'function');
  await ReactTestRenderer.act(async () => {
    login.props.onLoginSuccess(token, {
      id: 'rider-1', name: 'Rider', email: 'rider@example.test', profile_complete: true,
    });
    await flush();
  });
  return renderer;
}

async function pressLogout(renderer: ReactTestRenderer.ReactTestRenderer) {
  const logoutButton = renderer.root.find(node =>
    typeof node.props.onPress === 'function'
    && node.findAll(descendant => descendant.props.children === 'Logout').length > 0,
  );
  await ReactTestRenderer.act(async () => {
    await logoutButton.props.onPress();
    await flush();
  });
}

describe('authenticated logout lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as jest.Mock;
  });

  it('cleans up an active local session after a successful server logout without ending the ride', async () => {
    const renderer = await renderAuthenticatedApp();
    await pressLogout(renderer);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/logout$/),
      { method: 'POST', headers: { Authorization: 'Bearer logout-access-token' } },
    );
    expect(mockTelemetryStop).toHaveBeenCalledTimes(1);
    expect(mockSocketDisconnect).toHaveBeenCalled();
    const rideStore = jest.requireMock('../src/ride/ActiveRideStore');
    expect(rideStore.clearActiveRide).toHaveBeenCalledTimes(1);
    expect(rideStore.clearSession).toHaveBeenCalledTimes(1);
    expect(jest.requireMock('../src/ui/utils/SecureStore').clearBiometricLogin).toHaveBeenCalledTimes(1);
    expect(mockSocketEmitWithAck).not.toHaveBeenCalledWith('ride:end', expect.anything());
    expect(renderer.root.findAll(node => node.props.children === 'Logout')).toHaveLength(0);
    expect(renderer.root.find(node => typeof node.props.onLoginSuccess === 'function')).toBeDefined();
  });

  it('keeps local cleanup authoritative when the server logout request fails', async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/logout')) throw new Error('network unavailable');
      return { ok: true, json: async () => ({}) };
    }) as jest.Mock;
    const renderer = await renderAuthenticatedApp('offline-logout-token');
    await pressLogout(renderer);

    expect(mockTelemetryStop).toHaveBeenCalledTimes(1);
    expect(mockSocketDisconnect).toHaveBeenCalled();
    const rideStore = jest.requireMock('../src/ride/ActiveRideStore');
    expect(rideStore.clearActiveRide).toHaveBeenCalledTimes(1);
    expect(rideStore.clearSession).toHaveBeenCalledTimes(1);
    expect(jest.requireMock('../src/ui/utils/SecureStore').clearBiometricLogin).toHaveBeenCalledTimes(1);
    expect(mockSocketEmitWithAck).not.toHaveBeenCalledWith('ride:end', expect.anything());
    expect(renderer.root.findAll(node => node.props.children === 'Logout')).toHaveLength(0);
    expect(renderer.root.find(node => typeof node.props.onLoginSuccess === 'function')).toBeDefined();
  });
});
