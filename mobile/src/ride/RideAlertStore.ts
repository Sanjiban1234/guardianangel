export type RideAlertSeverity = 'info' | 'warning' | 'critical';

export type RideAlertType =
  | 'SEPARATION'
  | 'REUNION'
  | 'BREAKDOWN'
  | 'BREAKDOWN_RESOLVED'
  | 'REFUEL_REQUEST'
  | 'RIDER_JOINED'
  | 'RIDER_LEFT'
  | 'RIDER_DISCONNECTED'
  | 'RIDER_RECONNECTED'
  | 'SOS'
  | 'RIDE_STARTED'
  | 'WEATHER';

export interface RideAlert {
  id: string;
  type: RideAlertType;
  severity: RideAlertSeverity;
  timestamp: number;
  title: string;
  message?: string;
  riderId?: string;
  riderName?: string;
  vehicleModel?: string;
  plateNumber?: string;
  dedupeKey: string;
}

export interface RideAlertState {
  alerts: RideAlert[];
  criticalAlert: RideAlert | null;
}

export const EMPTY_RIDE_ALERT_STATE: RideAlertState = {
  alerts: [],
  criticalAlert: null,
};

const MAX_VISIBLE_ALERTS = 3;

/**
 * Presentation-only alert state. It intentionally has no knowledge of ride,
 * separation, or breakdown state, so dismissing a banner cannot clear it.
 */
export function enqueueRideAlert(state: RideAlertState, alert: RideAlert): RideAlertState {
  if (alert.severity === 'critical') {
    if (state.criticalAlert?.dedupeKey === alert.dedupeKey) return state;
    return { ...state, criticalAlert: alert };
  }

  if (state.alerts.some(existing => existing.dedupeKey === alert.dedupeKey)) return state;
  return { ...state, alerts: [alert, ...state.alerts].slice(0, MAX_VISIBLE_ALERTS) };
}

export function dismissRideAlert(state: RideAlertState, alertId: string): RideAlertState {
  return {
    alerts: state.alerts.filter(alert => alert.id !== alertId),
    criticalAlert: state.criticalAlert?.id === alertId ? null : state.criticalAlert,
  };
}

export function clearRideAlerts(): RideAlertState {
  return EMPTY_RIDE_ALERT_STATE;
}

export function clearWeatherRideAlerts(state: RideAlertState): RideAlertState {
  return { ...state, alerts: state.alerts.filter(alert => alert.type !== 'WEATHER') };
}
