/**
 * @file DeadEndAdvisoryBanner.tsx
 * @description Navigation advisory banner shown when the dead-end detector
 * raises a 'suspected' or 'confirmed' state.
 *
 * Design rules:
 * • Uses warning amber styling — NOT red/SOS styling
 * • This is navigation guidance, not an emergency alert
 * • Does NOT interact with SOS, crash detection, or separation systems
 * • Dismissible by the user (triggers detector cooldown)
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DeadEndState } from '../navigation/DeadEndDetector';

interface DeadEndAdvisoryBannerProps {
  /** Current state from DeadEndDetector. Only renders when 'suspected' or 'confirmed'. */
  state: DeadEndState;
  /** Called when user taps dismiss. Triggers detector cooldown. */
  onDismiss: () => void;
  /** Accessibility test ID. */
  testID?: string;
}

export const DeadEndAdvisoryBanner: React.FC<DeadEndAdvisoryBannerProps> = ({
  state,
  onDismiss,
  testID = 'dead-end-banner',
}) => {
  if (state.state !== 'suspected' && state.state !== 'confirmed') {
    return null;
  }

  const isConfirmed = state.state === 'confirmed';

  const title = isConfirmed
    ? 'No through route detected'
    : 'Route issue ahead';

  const body = isConfirmed
    ? 'You may need to return to the previous road to reach your destination.'
    : 'Current road may not continue toward your destination.';

  return (
    <View
      style={styles.banner}
      testID={testID}
      accessibilityRole="alert"
    >
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {isConfirmed ? '⚠️ ROUTE BLOCKED' : '⚠️ ROUTE ADVISORY'}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          style={styles.dismissBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss route advisory"
          testID={`${testID}-dismiss`}
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      </View>

      {/* Message */}
      <Text style={styles.title} testID={`${testID}-title`}>
        {title}
      </Text>
      <Text style={styles.body} testID={`${testID}-body`}>
        {body}
      </Text>

      {/* Low-urgency clarifier */}
      <Text style={styles.tag}>Navigation guidance · Not an emergency</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#2B2008',
    borderColor: '#F59E0B',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: '#4A3300',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '800',
  },
  dismissBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dismissText: {
    color: '#A3B8A8',
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  title: {
    color: '#F0FDF4',
    fontSize: 15,
    fontWeight: '800',
  },
  body: {
    color: '#FDE68A',
    fontSize: 13,
    lineHeight: 18,
  },
  tag: {
    color: '#A3B8A8',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
});

export default DeadEndAdvisoryBanner;
