import { ISocketClient } from '../types';

export interface LatestLocationSnapshot {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null | undefined;
}

export interface JoinedMember {
  user_id?: string;
  name?: string;
}

/**
 * Sends the most recent GPS sample only after session:join has acknowledged.
 */
export function emitLatestLocationAfterJoin(
  socketClient: Pick<ISocketClient, 'emitLocationUpdate'>,
  groupCode: string,
  location: LatestLocationSnapshot | null,
): boolean {
  if (
    !location ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  ) {
    return false;
  }

  const payload = {
    timestamp: Number.isFinite(location.timestamp) ? location.timestamp : Date.now(),
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: Number.isFinite(location.accuracy) ? location.accuracy : 0,
    speed: Number.isFinite(location.speed) ? location.speed as number : 0,
  };

  console.log(
    `[POST-JOIN LOCATION EMIT] groupCode=${groupCode} lat=${payload.latitude.toFixed(6)} lng=${payload.longitude.toFixed(6)}`,
  );
  socketClient.emitLocationUpdate(payload);
  return true;
}

/**
 * Existing room members resend their last sample when a peer joins, allowing
 * the newcomer to receive a position without waiting for another GPS update.
 */
export function resendLatestLocationForJoinedMember(
  socketClient: Pick<ISocketClient, 'isConnected' | 'emitLocationUpdate'>,
  groupCode: string,
  currentUserName: string,
  joinedMember: JoinedMember,
  location: LatestLocationSnapshot | null,
): boolean {
  if (!socketClient.isConnected() || !joinedMember.user_id || joinedMember.name === currentUserName) {
    return false;
  }
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return false;
  }

  console.log(
    `[MEMBER-JOINED LOCATION RESEND] joinedMember=${joinedMember.name || joinedMember.user_id} lat=${location.latitude.toFixed(6)} lng=${location.longitude.toFixed(6)}`,
  );
  return emitLatestLocationAfterJoin(socketClient, groupCode, location);
}
