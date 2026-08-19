import type { GroupSeparationAlertPayload } from '../../../contracts/websocket-events';

// The server is the source of truth for a separation. Keeping the original
// payload lets the UI present only values that the coherence service calculated.
export type RiderSeparation = GroupSeparationAlertPayload;
export type RiderSeparations = Record<string, RiderSeparation>;

export function recordSeparation(
  previous: RiderSeparations,
  payload: unknown,
): RiderSeparations {
  const alert = payload as Partial<GroupSeparationAlertPayload> | null;
  const riderId = alert?.separated_rider?.user_id;
  if (typeof riderId !== 'string' || riderId.length === 0) return previous;

  return {
    ...previous,
    [riderId]: payload as GroupSeparationAlertPayload,
  };
}

export function clearRiderSeparation(
  previous: RiderSeparations,
  riderId: unknown,
): RiderSeparations {
  if (typeof riderId !== 'string' || !(riderId in previous)) return previous;
  const { [riderId]: _cleared, ...remaining } = previous;
  return remaining;
}

export function clearAllSeparations(): RiderSeparations {
  return {};
}
