import { SocketClient } from '../src/telemetry/socket/SocketClient';

describe('SocketClient listener ownership', () => {
  it('emits pause/resume-style payloads with an acknowledgement callback', () => {
    const socket = { emit: jest.fn() };
    const client = new SocketClient();
    const acknowledgement = jest.fn();
    (client as any).socket = socket;
    (client as any).connected = true;

    client.emitEventWithAck('ride:pause', { group_code: 'ROOM123' }, acknowledgement);

    expect(socket.emit).toHaveBeenCalledWith('ride:pause', { group_code: 'ROOM123' }, acknowledgement);
  });

  it('cleans up an event listener on the socket instance that registered it', () => {
    const oldSocket = { on: jest.fn(), off: jest.fn() };
    const replacementSocket = { on: jest.fn(), off: jest.fn() };
    const client = new SocketClient();
    const listener = jest.fn();

    (client as any).socket = oldSocket;
    const cleanup = client.onEvent('location:broadcast', listener);

    // This mirrors a reconnect/replacement occurring before React cleanup.
    (client as any).socket = replacementSocket;
    cleanup();

    expect(oldSocket.on).toHaveBeenCalledWith('location:broadcast', listener);
    expect(oldSocket.off).toHaveBeenCalledWith('location:broadcast', listener);
    expect(replacementSocket.off).not.toHaveBeenCalled();
  });
});
