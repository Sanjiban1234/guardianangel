import {
  clearAllSeparations,
  clearRiderSeparation,
  recordSeparation,
} from '../SeparationState';

const alertFor = (userId: string, name: string, distance = 780) => ({
  separated_rider: {
    user_id: userId,
    name,
    current_speed: 8,
    recommended_speed: 9.2,
    distance_from_nearest_meters: distance,
  },
  meeting_point: { latitude: 27.7, longitude: 85.3, is_approximate: true },
  group_recommendation: { recommended_speed: 6.4 },
  timestamp: 1_700_000_000_000,
});

describe('rider-specific separation state', () => {
  it('stores one separation using the separated rider ID', () => {
    const state = recordSeparation({}, alertFor('rider-a', 'Asha'));
    expect(state['rider-a'].separated_rider.distance_from_nearest_meters).toBe(780);
  });

  it('clears only the reunited rider', () => {
    const state = recordSeparation(recordSeparation({}, alertFor('rider-a', 'Asha')), alertFor('rider-b', 'Bikash'));
    expect(clearRiderSeparation(state, 'rider-a')).toEqual({ 'rider-b': state['rider-b'] });
  });

  it('keeps two simultaneous rider separations independent', () => {
    const state = recordSeparation(recordSeparation({}, alertFor('rider-b', 'Bikash')), alertFor('rider-c', 'Chandra'));
    expect(Object.keys(state).sort()).toEqual(['rider-b', 'rider-c']);
  });

  it('removes a separated rider when they leave the group', () => {
    const state = recordSeparation({}, alertFor('rider-a', 'Asha'));
    expect(clearRiderSeparation(state, 'rider-a')).toEqual({});
  });

  it('clears all warnings when the ride ends', () => {
    const state = recordSeparation({}, alertFor('rider-a', 'Asha'));
    expect(clearAllSeparations()).toEqual({});
    expect(state).not.toEqual({});
  });

  it('ignores malformed payloads and preserves incomplete optional values without inventing guidance', () => {
    const state = recordSeparation({}, { separated_rider: { name: 'No ID' } });
    expect(state).toEqual({});

    const incomplete = {
      separated_rider: { user_id: 'rider-a', name: 'Asha', distance_from_nearest_meters: undefined },
      group_recommendation: { recommended_speed: null },
    };
    const stored = recordSeparation({}, incomplete);
    expect(stored['rider-a'].separated_rider.recommended_speed).toBeUndefined();
    expect(stored['rider-a'].group_recommendation.recommended_speed).toBeNull();
  });
});
