import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import {
  check,
  request,
  PERMISSIONS,
  RESULTS,
  openSettings,
  requestNotifications,
} from 'react-native-permissions';

type PermissionStatus = 'checking' | 'granted' | 'denied' | 'blocked';

interface PermissionGateProps {
  onPermissionsGranted: () => void;
  onCancel: () => void;
}

const COLORS = {
  ink: '#0B130E',
  card: '#142318',
  line: '#1E3A28',
  text: '#F0FDF4',
  muted: '#A3B8A8',
  green: '#16A34A',
  amber: '#F59E0B',
  red: '#DC2626',
};

export default function PermissionGate({
  onPermissionsGranted,
  onCancel,
}: PermissionGateProps) {
  const [foregroundStatus, setForegroundStatus] = useState<PermissionStatus>('checking');
  const [backgroundStatus, setBackgroundStatus] = useState<PermissionStatus>('checking');
  const [step, setStep] = useState<'foreground' | 'background' | 'complete'>('foreground');

  useEffect(() => {
    checkInitialPermissions();
  }, []);

  const completePermissionFlow = async () => {
    // Requested only when the rider enters the create/join flow, never at app launch.
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const notificationResult = await requestNotifications(['alert']);
      if (notificationResult.status !== RESULTS.GRANTED) {
        Alert.alert(
          'Tracking notification disabled',
          'Android will run ride tracking, but enable notifications in Settings to see its persistent status.',
        );
      }
    }
    onPermissionsGranted();
  };

  const checkInitialPermissions = async () => {
    try {
      // Check foreground location
      const foregroundPermission =
        Platform.OS === 'ios'
          ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE
          : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;

      const foregroundResult = await check(foregroundPermission);

      if (foregroundResult === RESULTS.GRANTED) {
        setForegroundStatus('granted');
        setStep('background');

        // Check background location
        const backgroundPermission =
          Platform.OS === 'ios'
            ? PERMISSIONS.IOS.LOCATION_ALWAYS
            : PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION;

        const backgroundResult = await check(backgroundPermission);

        if (backgroundResult === RESULTS.GRANTED) {
          setBackgroundStatus('granted');
          setStep('complete');
          await completePermissionFlow();
        } else if (backgroundResult === RESULTS.BLOCKED) {
          setBackgroundStatus('blocked');
        } else {
          setBackgroundStatus('denied');
        }
      } else if (foregroundResult === RESULTS.BLOCKED) {
        setForegroundStatus('blocked');
      } else {
        setForegroundStatus('denied');
      }
    } catch (error) {
      console.error('Permission check error:', error);
      setForegroundStatus('denied');
    }
  };

  const requestForegroundPermission = async () => {
    try {
      const foregroundPermission =
        Platform.OS === 'ios'
          ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE
          : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;

      const result = await request(foregroundPermission);

      if (result === RESULTS.GRANTED) {
        setForegroundStatus('granted');
        setStep('background');
        // Auto-check background permission
        checkInitialPermissions();
      } else if (result === RESULTS.BLOCKED) {
        setForegroundStatus('blocked');
      } else {
        setForegroundStatus('denied');
      }
    } catch (error) {
      console.error('Foreground permission request error:', error);
      setForegroundStatus('denied');
    }
  };

  const requestBackgroundPermission = async () => {
    try {
      // Android 10+ requires foreground to be granted first
      if (Platform.OS === 'android' && foregroundStatus !== 'granted') {
        Alert.alert(
          'Location Required',
          'Foreground location must be granted before requesting background location.',
          [{ text: 'OK' }]
        );
        return;
      }

      const backgroundPermission =
        Platform.OS === 'ios'
          ? PERMISSIONS.IOS.LOCATION_ALWAYS
          : PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION;

      const result = await request(backgroundPermission);

      if (result === RESULTS.GRANTED) {
        setBackgroundStatus('granted');
        setStep('complete');
        await completePermissionFlow();
      } else if (result === RESULTS.BLOCKED) {
        setBackgroundStatus('blocked');
      } else {
        setBackgroundStatus('denied');
      }
    } catch (error) {
      console.error('Background permission request error:', error);
      setBackgroundStatus('denied');
    }
  };

  const handleOpenSettings = () => {
    openSettings().catch(() => {
      Alert.alert(
        'Cannot Open Settings',
        'Please open Settings manually and grant location permissions to Guardian Angel.',
        [{ text: 'OK' }]
      );
    });
  };

  if (step === 'complete') {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.icon}>📍</Text>
          <Text style={styles.title}>Location Permission Required</Text>
          <Text style={styles.subtitle}>
            Guardian Angel is a safety app that requires location access to:
          </Text>
        </View>

        <View style={styles.featureList}>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>Track your position during group rides</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>Detect crashes and send emergency alerts</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>Monitor group separation and reunion</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>Continue tracking even with screen locked</Text>
          </View>
        </View>

        {step === 'foreground' && (
          <>
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>Step 1 of 2: Foreground Location</Text>
              <Text style={styles.statusDescription}>
                Allows location tracking while the app is active
              </Text>
            </View>

            {foregroundStatus === 'blocked' ? (
              <>
                <Text style={styles.blockedText}>
                  Location permission was blocked. Please enable it in Settings.
                </Text>
                <Pressable
                  style={styles.settingsButton}
                  onPress={handleOpenSettings}
                >
                  <Text style={styles.settingsButtonText}>Open Settings</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={styles.primaryButton}
                onPress={requestForegroundPermission}
              >
                <Text style={styles.primaryButtonText}>Grant Location Access</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'background' && (
          <>
            <View style={[styles.statusCard, styles.successCard]}>
              <Text style={styles.successText}>✓ Foreground location granted</Text>
            </View>

            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>Step 2 of 2: Background Location</Text>
              <Text style={styles.statusDescription}>
                Required for continuous safety monitoring during multi-hour rides
              </Text>
            </View>

            {backgroundStatus === 'blocked' ? (
              <>
                <Text style={styles.blockedText}>
                  Background location was blocked. Please enable "Allow all the time" in Settings.
                </Text>
                <Pressable
                  style={styles.settingsButton}
                  onPress={handleOpenSettings}
                >
                  <Text style={styles.settingsButtonText}>Open Settings</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={styles.primaryButton}
                onPress={requestBackgroundPermission}
              >
                <Text style={styles.primaryButtonText}>
                  Grant Background Access
                </Text>
              </Pressable>
            )}
          </>
        )}

        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>

        <Text style={styles.privacyNote}>
          Your location data is only used during active rides and is never shared
          without your permission.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ink,
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 24,
    gap: 20,
  },
  header: {
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  featureList: {
    gap: 12,
    paddingVertical: 8,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  featureBullet: {
    fontSize: 16,
    color: COLORS.green,
    fontWeight: '800',
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  statusCard: {
    backgroundColor: 'rgba(47, 128, 237, 0.1)',
    borderColor: 'rgba(47, 128, 237, 0.3)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  successCard: {
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
    borderColor: 'rgba(22, 163, 74, 0.3)',
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  statusDescription: {
    fontSize: 12,
    color: COLORS.muted,
    lineHeight: 18,
  },
  successText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.green,
  },
  primaryButton: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  settingsButton: {
    backgroundColor: COLORS.amber,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  settingsButtonText: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  cancelButton: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  blockedText: {
    fontSize: 13,
    color: COLORS.amber,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  privacyNote: {
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
    lineHeight: 16,
    fontStyle: 'italic',
  },
});
