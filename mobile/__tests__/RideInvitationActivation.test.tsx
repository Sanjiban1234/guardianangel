import React from 'react';
import renderer from 'react-test-renderer';
import { Alert, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import MapScreen from '../src/ui/MapScreen';
import FriendsScreen from '../src/friends/FriendsScreen';
import JoinRideScreen from '../src/ui/JoinRideScreen';
import { loadActiveRide } from '../src/ride/ActiveRideStore';

const mockEvents = new Map<string, (payload: any) => void>();
let mockConnect: (() => void) | undefined;
const mockJoin = jest.fn(async () => {
  mockEvents.get('session:joined')?.({ members: [{ user_id: 'b', name: 'B', role: 'member' }], ride_started_at: null });
});
jest.mock('../src/telemetry/socket/SocketClient', () => ({ SocketClient: jest.fn().mockImplementation(() => ({
  connect: jest.fn(async () => { mockConnect?.(); }), disconnect: jest.fn(), isConnected: () => true,
  onConnect: (fn: () => void) => { mockConnect = fn; return () => {}; }, onDisconnect: () => () => {},
  onEvent: (event: string, fn: any) => { mockEvents.set(event, fn); return () => mockEvents.delete(event); },
  joinSession: mockJoin, emitEvent: jest.fn(), emitWithAck: jest.fn(), emitLocationUpdate: jest.fn(), emitBulkSync: jest.fn(),
})) }));
jest.mock('../src/telemetry', () => ({ TelemetryModule: jest.fn().mockImplementation(() => ({ stop: jest.fn(async () => {}), start: jest.fn(async () => {}), onReading: () => () => {} })) }));
jest.mock('../src/telemetry/location/LocationProvider', () => ({ CommunityGeolocationProvider: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../src/ui/MapScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const room = { room_id: 'room-a', group_code: 'ABCDEF123456', status: 'active', role: 'member', rideStartedAt: null,
  destination: { latitude: 28, longitude: 84, label: 'Pokhara' } };
let pending: boolean;
let failAccept: boolean;
const trees: renderer.ReactTestRenderer[] = [];
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
async function mount() {
  let tree!: renderer.ReactTestRenderer;
  await renderer.act(async () => { tree = renderer.create(<App />); await flush(); });
  trees.push(tree); return tree;
}
async function login(tree: renderer.ReactTestRenderer) {
  await renderer.act(async () => { tree.root.find(node => typeof node.props.onLoginSuccess === 'function').props.onLoginSuccess('token', { id: 'b', name: 'B', profile_complete: true }); await flush(); });
}
async function friends(tree: renderer.ReactTestRenderer) {
  await renderer.act(async () => { tree.root.find(node => typeof node.props.onOpenFriends === 'function').props.onOpenFriends(); await flush(); });
}
describe('invitation and manual entry activate the real App ride lifecycle', () => {
  beforeEach(async () => {
    await AsyncStorage.clear(); jest.clearAllMocks(); mockEvents.clear(); pending = true; failAccept = false;
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/accept')) {
        if (failAccept) return { ok: false, json: async () => ({ error: 'You are already participating in another active ride.' }) };
        pending = false; return { ok: true, json: async () => room };
      }
      if (url.endsWith('/ride-invitations')) return { ok: true, json: async () => pending ? [{ id: 'i', room_id: room.room_id, inviter_name: 'A' }] : [] };
      if (url.endsWith('/rooms/join') || url.endsWith('/session')) return { ok: true, json: async () => room };
      if (url.includes('/friends')) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({}) };
    }) as jest.Mock;
  });
  afterEach(async () => { await renderer.act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); jest.restoreAllMocks(); });

  it('taps Accept, persists, joins the normal socket session, hydrates roster, opens the map and restores after restart', async () => {
    const tree = await mount(); await login(tree); await friends(tree);
    await renderer.act(async () => { await tree.root.findByProps({ testID: 'accept-ride-i' }).props.onPress(); await flush(); });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/ride-invitations\/i\/accept$/), expect.objectContaining({ method: 'POST' }));
    expect((global.fetch as jest.Mock).mock.calls.some(([url]) => url.endsWith('/rooms/join'))).toBe(false);
    expect(mockJoin).toHaveBeenCalledWith(room.group_code);
    expect(tree.root.findByType(MapScreen).props).toMatchObject({ roomCode: room.group_code, roomId: room.room_id, isHost: false, rideStarted: false, destination: room.destination });
    expect(tree.root.findByType(MapScreen).props.members).toHaveLength(1);
    expect(tree.root.findAllByType(FriendsScreen)).toHaveLength(0);
    expect(await loadActiveRide()).toMatchObject({ groupCode: room.group_code, userId: 'b', destination: room.destination });
    for (const event of ['session:member_joined', 'session:member_left', 'ride:started', 'ride:ended', 'location:broadcast', 'group:separationAlert', 'group:reunited', 'vehicle:breakdownReported', 'refill:notified', 'sos:broadcast']) {
      expect(mockEvents.has(event)).toBe(true);
    }
    await renderer.act(async () => { tree.unmount(); }); trees.splice(trees.indexOf(tree), 1);
    mockJoin.mockClear();
    const restored = await mount();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/rooms\/ABCDEF123456\/session$/), expect.anything());
    expect(restored.root.findByType(MapScreen).props).toMatchObject({ roomCode: room.group_code, roomId: room.room_id });
    expect(mockJoin).toHaveBeenCalledWith(room.group_code);
  });
  it('manual code submission still activates the same map and persistent session', async () => {
    const tree = await mount(); await login(tree);
    await renderer.act(async () => { await tree.root.find(node => typeof node.props.onJoinRide === 'function').props.onJoinRide(); });
    const gate = tree.root.findAll(node => typeof node.props.onPermissionsGranted === 'function');
    if (gate.length) await renderer.act(async () => gate[0].props.onPermissionsGranted());
    const join = tree.root.findByType(JoinRideScreen);
    await renderer.act(async () => join.findByType(TextInput).props.onChangeText(room.group_code));
    const button = join.findAll(node => typeof node.props.onPress === 'function').find(node => node.findAll(child => child.props.children === 'Join Group Ride →').length > 0)!;
    await renderer.act(async () => { await button.props.onPress(); await flush(); });
    expect(tree.root.findByType(MapScreen).props.roomCode).toBe(room.group_code);
    expect(mockJoin).toHaveBeenCalledWith(room.group_code);
    expect(await loadActiveRide()).toMatchObject({ groupCode: room.group_code });
  });
  it('a different-room error leaves the invitation visible without activating or persisting', async () => {
    const tree = await mount(); await login(tree); await friends(tree); failAccept = true;
    await renderer.act(async () => { await tree.root.findByProps({ testID: 'accept-ride-i' }).props.onPress(); });
    expect(Alert.alert).toHaveBeenCalledWith('Ride invitation', 'You are already participating in another active ride.');
    expect(tree.root.findAllByType(MapScreen)).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'accept-ride-i' })).toBeDefined();
    expect(await loadActiveRide()).toBeNull(); expect(mockJoin).not.toHaveBeenCalled();
  });
});
