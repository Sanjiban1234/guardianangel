import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { RideAlert, RideAlertState } from '../ride/RideAlertStore';

interface RideAlertOverlayProps extends RideAlertState {
  onDismiss: (alertId: string) => void;
}

const AUTO_DISMISS_MS = { info: 5_000, warning: 15_000 } as const;

function AlertCard({ alert, onDismiss }: { alert: RideAlert; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (alert.severity === 'critical') return undefined;
    const timeout = setTimeout(() => onDismiss(alert.id), AUTO_DISMISS_MS[alert.severity]);
    return () => clearTimeout(timeout);
  }, [alert.id, alert.severity, onDismiss]);

  return (
    <View style={[styles.card, alert.severity === 'warning' ? styles.warningCard : styles.infoCard]}>
      <View style={styles.copy}>
        <Text style={styles.title}>{alert.title}</Text>
        {!!alert.message && <Text style={styles.message}>{alert.message}</Text>}
      </View>
      <Pressable accessibilityLabel="Dismiss ride alert" onPress={() => onDismiss(alert.id)} style={styles.dismiss}>
        <Text style={styles.dismissText}>×</Text>
      </Pressable>
    </View>
  );
}

export default function RideAlertOverlay({ alerts, criticalAlert, onDismiss }: RideAlertOverlayProps) {
  return (
    <>
      {alerts.length > 0 && (
        <View pointerEvents="box-none" style={styles.stack}>
          {alerts.map(alert => <AlertCard key={alert.id} alert={alert} onDismiss={onDismiss} />)}
        </View>
      )}
      <Modal visible={!!criticalAlert} transparent animationType="fade" onRequestClose={() => {
        if (criticalAlert) onDismiss(criticalAlert.id);
      }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.criticalCard}>
            <Text style={styles.criticalEyebrow}>EMERGENCY SOS</Text>
            <Text style={styles.criticalTitle}>{criticalAlert?.riderName || criticalAlert?.title}</Text>
            {!!criticalAlert?.vehicleModel && <Text style={styles.criticalDetail}>Bike: {criticalAlert.vehicleModel}</Text>}
            {!!criticalAlert?.plateNumber && <Text style={styles.criticalDetail}>Plate: {criticalAlert.plateNumber}</Text>}
            {!!criticalAlert?.message && <Text style={styles.criticalMessage}>{criticalAlert.message}</Text>}
            {criticalAlert && (
              <Pressable onPress={() => onDismiss(criticalAlert.id)} style={styles.acknowledge}>
                <Text style={styles.acknowledgeText}>Acknowledge</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', top: 145, left: 16, right: 16, gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingLeft: 12, paddingRight: 8, flexDirection: 'row', alignItems: 'center' },
  infoCard: { backgroundColor: 'rgba(20, 35, 24, 0.97)', borderColor: '#1E3A28' },
  warningCard: { backgroundColor: 'rgba(63, 43, 8, 0.97)', borderColor: '#F59E0B' },
  copy: { flex: 1 },
  title: { color: '#F0FDF4', fontSize: 14, fontWeight: '800' },
  message: { color: '#D1E1D5', fontSize: 12, marginTop: 2 },
  dismiss: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: '#F0FDF4', fontSize: 24, lineHeight: 25 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  criticalCard: { width: '100%', borderRadius: 18, padding: 22, backgroundColor: '#351111', borderColor: '#DC2626', borderWidth: 2 },
  criticalEyebrow: { color: '#FCA5A5', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  criticalTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 6 },
  criticalDetail: { color: '#FEE2E2', fontSize: 14, marginTop: 8 },
  criticalMessage: { color: '#FEE2E2', fontSize: 14, marginTop: 14, lineHeight: 20 },
  acknowledge: { backgroundColor: '#DC2626', borderRadius: 10, alignItems: 'center', paddingVertical: 13, marginTop: 20 },
  acknowledgeText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
});
