import React from 'react';
import renderer from 'react-test-renderer';
import FriendsScreen from '../FriendsScreen';

const response = (body: unknown) => ({ ok: true, json: async () => body });

describe('FriendsScreen privacy-safe coordination UI', () => {
  beforeEach(() => { global.fetch = jest.fn(); });

  it('renders empty coordination states without private profile data', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response([]));
    let tree: renderer.ReactTestRenderer;
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen onConfirmJoin={jest.fn()} apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} />); });
    const text = JSON.stringify(tree!.toJSON());
    expect(text).toContain('No friends yet');
    expect(text).toContain('No incoming ride invitations');
    // The explanatory privacy copy may mention location/email; no sensitive
    // values or privileged feature controls are rendered.
    for (const forbidden of ['blood group', 'emergency contact', 'plate number', 'guardian portal', 'ride history']) expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it('renders only display name and username for a populated friend result', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response([{ userId: 'friend-1', displayName: 'Safe Rider', username: 'safe_rider' }]))
      .mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([]));
    let tree: renderer.ReactTestRenderer;
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen onConfirmJoin={jest.fn()} apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} />); });
    const text = JSON.stringify(tree!.toJSON());
    expect(text).toContain('Safe Rider'); expect(text).toContain('safe_rider');
    expect(text).not.toContain('rider@example.com'); expect(text).not.toContain('+977');
  });

  it('refreshes REST-authoritative state when the realtime refresh signal changes', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response([]));
    let tree: renderer.ReactTestRenderer;
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen onConfirmJoin={jest.fn()} apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} refreshSignal={0} />); });
    const initialCalls = (global.fetch as jest.Mock).mock.calls.length;
    await renderer.act(async () => { tree!.update(<FriendsScreen onConfirmJoin={jest.fn()} apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} refreshSignal={1} />); });
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('removes the accepted card and prevents a stale refresh from making it actionable again', async () => {
    const invitation = { id: 'ride-1', room_id: 'room-1' };
    const joined = { room_id: 'room-1', group_code: 'ABCDEF123456', status: 'active', role: 'member', rideStartedAt: null };
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => response(url.endsWith('/accept') ? joined : url.endsWith('/ride-invitations') ? [invitation] : []));
    const activate = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen onConfirmJoin={activate} apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} />); });
    await renderer.act(async () => { await tree.root.findByProps({ testID: 'accept-ride-ride-1' }).props.onPress(); });
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'room-1', groupCode: joined.group_code }));
    expect(tree.root.findAllByProps({ testID: 'accept-ride-ride-1' })).toHaveLength(0);
    await renderer.act(async () => { tree.update(<FriendsScreen onConfirmJoin={activate} apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} refreshSignal={1} />); });
    expect(tree.root.findAllByProps({ testID: 'accept-ride-ride-1' })).toHaveLength(0);
    await renderer.act(async () => tree.unmount());
  });

  it('declines and refreshes without calling room activation', async () => {
    let pending = true;
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.endsWith('/decline')) pending = false;
      return response(url.endsWith('/ride-invitations') && pending ? [{ id: 'ride-1', room_id: 'room-1' }] : []);
    });
    const activate = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen onConfirmJoin={activate} apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} />); });
    const decline = tree.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.findAll(child => child.props.children === 'Decline').length > 0)!;
    await renderer.act(async () => { await decline.props.onPress(); });
    expect(activate).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ testID: 'accept-ride-ride-1' })).toHaveLength(0);
    await renderer.act(async () => tree.unmount());
  });
});
