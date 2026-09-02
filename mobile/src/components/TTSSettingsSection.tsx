import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VoiceProps } from '@mhpdev/react-native-speech';
import { DEFAULT_TTS_SETTINGS, GuardianAngelTTS, TTSSettings } from '../services/GuardianAngelTTS';

const RATES = [0.5, 0.75, 1, 1.25, 1.5];

export default function TTSSettingsSection() {
  const [settings, setSettings] = useState<TTSSettings>(DEFAULT_TTS_SETTINGS);
  const [voices, setVoices] = useState<VoiceProps[]>([]);

  useEffect(() => {
    const unsubscribe = GuardianAngelTTS.subscribe(setSettings);
    void GuardianAngelTTS.initialize().then(async () => {
      setSettings(GuardianAngelTTS.getSettings());
      setVoices(await GuardianAngelTTS.getVoices());
    });
    return unsubscribe;
  }, []);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Voice Alerts</Text>
      <Text style={styles.copy}>Spoken safety alerts supplement the map, banners, and emergency screens.</Text>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: settings.enabled }}
        onPress={() => void GuardianAngelTTS.setEnabled(!settings.enabled)} style={styles.row}>
        <Text style={styles.label}>Voice Alerts</Text>
        <Text style={[styles.value, settings.enabled && styles.enabled]}>{settings.enabled ? 'ON' : 'OFF'}</Text>
      </Pressable>
      <Text style={styles.fieldLabel}>SPEECH RATE</Text>
      <View style={styles.chips}>
        {RATES.map(rate => <Pressable key={rate} onPress={() => void GuardianAngelTTS.setRate(rate)}
          style={[styles.chip, settings.rate === rate && styles.selectedChip]}>
          <Text style={[styles.chipText, settings.rate === rate && styles.selectedText]}>{rate.toFixed(2).replace(/0$/, '')}x</Text>
        </Pressable>)}
      </View>
      <Text style={styles.fieldLabel}>VOICE</Text>
      <Pressable onPress={() => void GuardianAngelTTS.setVoice(null)} style={[styles.voice, settings.voiceId === null && styles.selectedChip]}>
        <Text style={[styles.chipText, settings.voiceId === null && styles.selectedText]}>System default</Text>
      </Pressable>
      <ScrollView style={styles.voiceList} nestedScrollEnabled>
        {voices.map(voice => <Pressable key={voice.identifier} onPress={() => void GuardianAngelTTS.setVoice(voice.identifier)}
          style={[styles.voice, settings.voiceId === voice.identifier && styles.selectedChip]}>
          <Text style={[styles.chipText, settings.voiceId === voice.identifier && styles.selectedText]}>
            {voice.name || voice.identifier} · {voice.language}
          </Text>
        </Pressable>)}
        {voices.length === 0 && <Text style={styles.empty}>No selectable system voices were reported. The system default will be used.</Text>}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable disabled={!settings.enabled} onPress={() => void GuardianAngelTTS.speak('Guardian Angel is active.')}
          style={[styles.action, !settings.enabled && styles.disabled]}><Text style={styles.actionText}>Test Voice</Text></Pressable>
        <Pressable onPress={() => void GuardianAngelTTS.stop()} style={styles.stop}><Text style={styles.stopText}>Stop Speaking</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#142318', borderColor: '#1E3A28', borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  title: { color: '#F0FDF4', fontSize: 17, fontWeight: '800' }, copy: { color: '#A3B8A8', fontSize: 12, lineHeight: 17 },
  row: { backgroundColor: '#0F1A12', borderRadius: 10, padding: 12, flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: '#F0FDF4', fontWeight: '700' }, value: { color: '#A3B8A8', fontWeight: '900' }, enabled: { color: '#4ADE80' },
  fieldLabel: { color: '#A3B8A8', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { backgroundColor: '#0F1A12', borderColor: '#1E3A28', borderWidth: 1, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 },
  selectedChip: { backgroundColor: '#14532D', borderColor: '#4ADE80' }, chipText: { color: '#A3B8A8', fontSize: 12, fontWeight: '700' }, selectedText: { color: '#F0FDF4' },
  voiceList: { maxHeight: 150 }, voice: { backgroundColor: '#0F1A12', borderColor: '#1E3A28', borderWidth: 1, borderRadius: 9, padding: 10, marginBottom: 6 },
  empty: { color: '#A3B8A8', fontSize: 11, lineHeight: 16 }, actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  action: { flex: 1, backgroundColor: '#16A34A', borderRadius: 10, padding: 12, alignItems: 'center' }, actionText: { color: '#0B130E', fontWeight: '900' },
  stop: { flex: 1, borderColor: '#DC2626', borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' }, stopText: { color: '#F87171', fontWeight: '800' }, disabled: { opacity: 0.45 },
});
