import {
  compactRiderName,
  peerRiderVisualState,
  riderLastUpdateText,
  riderStatusText,
} from '../PeerRiderMarker';
import { DESTINATION_PIN_COLOR } from '../LiveMapView';

describe('PeerRiderMarker presentation helpers', () => {
  const rider = {
    user_id: 'rider-1', name: 'Radium Gautam', latitude: 27.7, longitude: 85.3,
    vehicleModel: 'Yamaha MT-15', plateNumber: 'BA 12 PA 3456', lastUpdatedAt: Date.now() - 3_000,
  };

  it('uses the live rider visual state only for fresh connected telemetry', () => {
    expect(peerRiderVisualState({ ...rider, connectionState: 'CONNECTED', locationFreshness: 'FRESH' })).toBe('LIVE');
    expect(riderStatusText({ ...rider, connectionState: 'CONNECTED', locationFreshness: 'FRESH' })).toBe('Connected');
  });

  it('uses an amber stale state without claiming a rider is live', () => {
    expect(peerRiderVisualState({ ...rider, connectionState: 'CONNECTED', locationFreshness: 'STALE' })).toBe('STALE');
    expect(riderStatusText({ ...rider, connectionState: 'CONNECTED', locationFreshness: 'STALE' })).toBe('Stale location');
  });

  it('uses a muted last-known state for disconnected riders', () => {
    expect(peerRiderVisualState({ ...rider, connectionState: 'DISCONNECTED', locationFreshness: 'STALE' })).toBe('DISCONNECTED');
    expect(riderStatusText({ ...rider, connectionState: 'DISCONNECTED' })).toBe('Disconnected · last known location');
  });

  it('formats real identity details only when supplied', () => {
    expect(compactRiderName(rider.name)).toBe('Radium');
    expect(riderLastUpdateText(rider.lastUpdatedAt)).toMatch(/^Updated \d+ sec ago$/);
    expect(riderLastUpdateText(undefined)).toBe('Last update unavailable');
  });

  it('keeps the destination in a separate pin visual vocabulary', () => {
    expect(DESTINATION_PIN_COLOR).toBe('#DC2626');
  });
});
