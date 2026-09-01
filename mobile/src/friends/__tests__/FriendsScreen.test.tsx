import React from 'react';
import renderer from 'react-test-renderer';
import FriendsScreen from '../FriendsScreen';

const response = (body: unknown) => ({ ok: true, json: async () => body });

describe('FriendsScreen privacy-safe coordination UI', () => {
  beforeEach(() => { global.fetch = jest.fn(); });

  it('renders empty coordination states without private profile data', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response([]));
    let tree: renderer.ReactTestRenderer;
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} />); });
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
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} />); });
    const text = JSON.stringify(tree!.toJSON());
    expect(text).toContain('Safe Rider'); expect(text).toContain('safe_rider');
    expect(text).not.toContain('rider@example.com'); expect(text).not.toContain('+977');
  });

  it('refreshes REST-authoritative state when the realtime refresh signal changes', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(response([]));
    let tree: renderer.ReactTestRenderer;
    await renderer.act(async () => { tree = renderer.create(<FriendsScreen apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} refreshSignal={0} />); });
    const initialCalls = (global.fetch as jest.Mock).mock.calls.length;
    await renderer.act(async () => { tree!.update(<FriendsScreen apiBaseUrl="https://api.example" authToken="token" onBack={jest.fn()} refreshSignal={1} />); });
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
