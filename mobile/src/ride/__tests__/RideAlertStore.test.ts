import {
  clearRideAlerts,
  dismissRideAlert,
  enqueueRideAlert,
  RideAlert,
} from '../RideAlertStore';
import { clearRiderSeparation, recordSeparation } from '../../separation/SeparationState';

const alert = (overrides: Partial<RideAlert> = {}): RideAlert => ({
  id: 'alert-1', type: 'SEPARATION', severity: 'warning', timestamp: 1,
  title: 'Rider is separated', riderId: 'rider-1', riderName: 'Rider One',
  dedupeKey: 'separation:rider-1', ...overrides,
});

describe('RideAlertStore', () => {
  it('keeps a dismissal separate from persistent rider separation state', () => {
    const separation = recordSeparation({}, {
      separated_rider: { user_id: 'rider-1', name: 'Rider One', current_speed: 1, recommended_speed: null, distance_from_nearest_meters: 700 },
      meeting_point: { latitude: 1, longitude: 1, is_approximate: true },
      group_recommendation: { recommended_speed: null }, timestamp: 1,
    });
    const visible = enqueueRideAlert(clearRideAlerts(), alert());

    expect(dismissRideAlert(visible, 'alert-1').alerts).toEqual([]);
    expect(separation['rider-1']).toBeDefined();
  });

  it('supports two separated riders and clears only the reunited rider persistent state', () => {
    const first = enqueueRideAlert(clearRideAlerts(), alert());
    const both = enqueueRideAlert(first, alert({ id: 'alert-2', riderId: 'rider-2', riderName: 'Rider Two', dedupeKey: 'separation:rider-2' }));
    const separation = recordSeparation(recordSeparation({}, {
      separated_rider: { user_id: 'rider-1', name: 'Rider One', current_speed: 1, recommended_speed: null, distance_from_nearest_meters: 700 },
      meeting_point: { latitude: 1, longitude: 1, is_approximate: true }, group_recommendation: { recommended_speed: null }, timestamp: 1,
    }), {
      separated_rider: { user_id: 'rider-2', name: 'Rider Two', current_speed: 1, recommended_speed: null, distance_from_nearest_meters: 800 },
      meeting_point: { latitude: 1, longitude: 1, is_approximate: true }, group_recommendation: { recommended_speed: null }, timestamp: 2,
    });

    expect(both.alerts).toHaveLength(2);
    expect(clearRiderSeparation(separation, 'rider-1')).toEqual({ 'rider-2': separation['rider-2'] });
  });

  it('deduplicates repeated server events but retains distinct event types', () => {
    const first = enqueueRideAlert(clearRideAlerts(), alert());
    const repeated = enqueueRideAlert(first, alert({ id: 'alert-duplicate', timestamp: 2 }));
    const breakdown = enqueueRideAlert(repeated, alert({
      id: 'breakdown-1', type: 'BREAKDOWN', title: 'Rider reported a breakdown', dedupeKey: 'breakdown:1',
    }));

    expect(repeated.alerts).toHaveLength(1);
    expect(breakdown.alerts).toHaveLength(2);
  });

  it('acknowledges a critical SOS without affecting non-critical alerts', () => {
    const warning = enqueueRideAlert(clearRideAlerts(), alert());
    const critical = enqueueRideAlert(warning, alert({
      id: 'sos-1', type: 'SOS', severity: 'critical', title: 'Emergency SOS', dedupeKey: 'sos:alarm-1',
    }));
    const acknowledged = dismissRideAlert(critical, 'sos-1');

    expect(acknowledged.criticalAlert).toBeNull();
    expect(acknowledged.alerts).toHaveLength(1);
  });

  it('retains alerts when optional rider and vehicle details are unavailable', () => {
    const state = enqueueRideAlert(clearRideAlerts(), alert({
      id: 'refuel-1', type: 'REFUEL_REQUEST', severity: 'info', riderId: undefined,
      riderName: undefined, vehicleModel: undefined, plateNumber: undefined, message: undefined,
      dedupeKey: 'refuel:1',
    }));

    expect(state.alerts[0]).toMatchObject({ type: 'REFUEL_REQUEST', message: undefined });
  });

  it('clears alerts on room lifecycle cleanup', () => {
    const state = enqueueRideAlert(clearRideAlerts(), alert());
    expect(clearRideAlerts()).not.toBe(state);
    expect(clearRideAlerts()).toEqual({ alerts: [], criticalAlert: null });
  });
});
