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

export interface CurrentPositionProvider {
  getCurrentPosition(
    success: (position: unknown) => void,
    failure: (error: unknown) => void,
    options: { enableHighAccuracy: boolean; timeout: number; maximumAge: number },
  ): void;
}

export function hasValidLatestLocation(location: LatestLocationSnapshot | null): location is LatestLocationSnapshot {
  return !!location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
}

export function normalizeCurrentPosition(position: any): LatestLocationSnapshot | null {
  const latitude = Number(position?.coords?.latitude);
  const longitude = Number(position?.coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    timestamp: Number.isFinite(position?.timestamp) ? position.timestamp : Date.now(),
    latitude,
    longitude,
    accuracy: Number.isFinite(position?.coords?.accuracy) ? position.coords.accuracy : 0,
    speed: Number.isFinite(position?.coords?.speed) ? position.coords.speed : 0,
  };
}

/** One-shot fix used only after room membership is established and no cache exists. */
export function getCurrentPositionAfterJoin(
  geolocation: CurrentPositionProvider,
): Promise<LatestLocationSnapshot> {
  console.log('[POST-JOIN GET CURRENT POSITION]');
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const location = normalizeCurrentPosition(position);
        if (!location) {
          const error = new Error('Current position did not contain valid coordinates');
          console.warn(`[POST-JOIN CURRENT POSITION ERROR] message=${error.message}`);
          reject(error);
          return;
        }
        console.log(
          `[POST-JOIN CURRENT POSITION SUCCESS] lat=${location.latitude.toFixed(6)} lng=${location.longitude.toFixed(6)}`,
        );
        resolve(location);
      },
      (error: any) => {
        console.warn(
          `[POST-JOIN CURRENT POSITION ERROR] code=${error?.code ?? 'unknown'} message=${error?.message ?? 'unknown'}`,
        );
        reject(error instanceof Error ? error : new Error(error?.message || 'Current position unavailable'));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

/**
 * Sends the most recent GPS sample only after session:join has acknowledged.
 */
export function emitLatestLocationAfterJoin(
  socketClient: Pick<ISocketClient, 'emitLocationUpdate'>,
  groupCode: string,
  location: LatestLocationSnapshot | null,
): boolean {
  if (!hasValidLatestLocation(location)) {
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
  if (!hasValidLatestLocation(location)) {
    return false;
  }

  console.log(
    `[MEMBER-JOINED LOCATION RESEND] joinedMember=${joinedMember.name || joinedMember.user_id} lat=${location.latitude.toFixed(6)} lng=${location.longitude.toFixed(6)}`,
  );
  return emitLatestLocationAfterJoin(socketClient, groupCode, location);
}
