import AsyncStorage from '@react-native-async-storage/async-storage';
import Speech from '@mhpdev/react-native-speech';
import { GuardianAngelTTSService, TTSPriority, TTS_SETTINGS_KEY } from '../GuardianAngelTTS';

jest.mock('@mhpdev/react-native-speech');
const speech = Speech as jest.Mocked<typeof Speech>;
const voices = [{ identifier: 'voice-one', name: 'Voice One', language: 'en-US', quality: 'Default' as const }];

describe('GuardianAngelTTSService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    speech.getAvailableVoices.mockResolvedValue(voices);
    speech.isSpeaking.mockResolvedValue(false);
    speech.speak.mockResolvedValue('utterance-id');
    speech.stop.mockResolvedValue(undefined);
  });

  it('uses enabled and 1x defaults and persists settings', async () => {
    const service = new GuardianAngelTTSService();
    await service.initialize();
    expect(service.getSettings()).toEqual({ enabled: true, rate: 1, voiceId: null });
    await service.setEnabled(false);
    await service.setRate(1.25);
    expect(JSON.parse((await AsyncStorage.getItem(TTS_SETTINGS_KEY))!)).toEqual({ enabled: false, rate: 1.25, voiceId: null });
  });

  it('clamps invalid speech rates to the supported range', async () => {
    const service = new GuardianAngelTTSService();
    await service.setRate(9); expect(service.getSettings().rate).toBe(1.5);
    await service.setRate(0.1); expect(service.getSettings().rate).toBe(0.5);
  });

  it('restores an available voice and falls back if it disappears', async () => {
    await AsyncStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify({ enabled: true, rate: 1, voiceId: 'voice-one' }));
    const available = new GuardianAngelTTSService(); await available.initialize();
    expect(available.getSettings().voiceId).toBe('voice-one');
    speech.getAvailableVoices.mockResolvedValue([]);
    const missing = new GuardianAngelTTSService(); await missing.initialize();
    expect(missing.getSettings().voiceId).toBeNull();
  });

  it('speaks once per separation transition and allows a new separation after reunion', async () => {
    const service = new GuardianAngelTTSService();
    await service.announceSeparation('rider-1', 'Ram', 620);
    await service.announceSeparation('rider-1', 'Ram', 650);
    expect(speech.speak).toHaveBeenCalledTimes(1);
    await service.announceReunion('rider-1', 'Ram');
    await service.announceSeparation('rider-1', 'Ram', 700);
    expect(speech.speak).toHaveBeenCalledTimes(3);
  });

  it('deduplicates disconnects and permits reconnect state transitions', async () => {
    const service = new GuardianAngelTTSService();
    await service.announceDisconnect('rider-1', 'Ram');
    await service.announceDisconnect('rider-1', 'Ram');
    await service.announceReconnect('rider-1', 'Ram');
    expect(speech.speak).toHaveBeenCalledTimes(2);
  });

  it('does not call native speech while disabled and stops immediately', async () => {
    const service = new GuardianAngelTTSService();
    await service.setEnabled(false);
    expect(speech.stop).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    expect(await service.announceBreakdown('rider-1', 'Ram')).toBe(false);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('drops ordinary queued speech but interrupts for an emergency', async () => {
    const service = new GuardianAngelTTSService();
    speech.isSpeaking.mockResolvedValue(true);
    expect(await service.speak('Ride started.', { priority: TTSPriority.INFO })).toBe(false);
    expect(await service.announceSOS('rider-1', 'Ram')).toBe(true);
    expect(speech.stop).toHaveBeenCalledTimes(1);
    expect(speech.speak).toHaveBeenCalledWith('SOS received from Ram.', expect.any(Object));
  });
});
