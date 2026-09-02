import AsyncStorage from '@react-native-async-storage/async-storage';
import Speech, { VoiceProps } from '@mhpdev/react-native-speech';

export enum TTSPriority { INFO = 0, WARNING = 1, HIGH = 2, EMERGENCY = 3 }

export interface TTSSettings { enabled: boolean; rate: number; voiceId: string | null; }
export interface SpeakOptions { priority?: TTSPriority; key?: string; cooldownMs?: number; }
export interface WeatherSpeechSnapshot {
  current: { condition: string; temperatureC?: number | null } | null;
  advisories: Array<{ type?: string }>;
  isStale: boolean;
}

const SETTINGS_KEY = '@guardian_angel/tts_settings';
const DEFAULT_SETTINGS: TTSSettings = { enabled: true, rate: 1, voiceId: null };
const DEFAULT_COOLDOWN_MS = 60_000;
type SettingsListener = (settings: TTSSettings) => void;

export class GuardianAngelTTSService {
  private settings = DEFAULT_SETTINGS;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private lastSpokenAt = new Map<string, number>();
  private activeTransitions = new Set<string>();
  private activeWeatherAdvisories = new Set<string>();
  private weatherSummaryAnnounced = false;
  private activePriority: TTSPriority | null = null;
  private listeners = new Set<SettingsListener>();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const stored = await AsyncStorage.getItem(SETTINGS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<TTSSettings>;
          this.settings = {
            enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
            rate: this.validateRate(parsed.rate),
            voiceId: typeof parsed.voiceId === 'string' ? parsed.voiceId : null,
          };
        }
        await this.restoreVoice();
        this.configureNative();
      } catch (error) {
        console.warn('[TTS] initialization failed', error);
        this.settings = DEFAULT_SETTINGS;
      } finally {
        this.initialized = true;
        this.initializing = null;
        this.notify();
      }
    })();
    return this.initializing;
  }

  getSettings(): TTSSettings { return { ...this.settings }; }
  subscribe(listener: SettingsListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.initialize();
    this.settings = { ...this.settings, enabled };
    if (!enabled) {
      this.lastSpokenAt.clear();
      this.activeTransitions.clear();
      this.resetWeatherTransitions();
      await this.stop();
    }
    await this.persist();
  }

  async setRate(rate: number): Promise<void> {
    await this.initialize();
    this.settings = { ...this.settings, rate: this.validateRate(rate) };
    this.configureNative();
    await this.persist();
  }

  async setVoice(voiceId: string | null): Promise<void> {
    await this.initialize();
    const voices = await this.getVoices();
    this.settings = { ...this.settings, voiceId: voiceId && voices.some(voice => voice.identifier === voiceId) ? voiceId : null };
    this.configureNative();
    await this.persist();
  }

  async getVoices(): Promise<VoiceProps[]> {
    try { return (await Speech.getAvailableVoices()).filter(voice => Boolean(voice.identifier && voice.language)); }
    catch (error) { console.warn('[TTS] voices unavailable', error); return []; }
  }

  async speak(message: string, options: SpeakOptions = {}): Promise<boolean> {
    await this.initialize();
    if (!this.settings.enabled || !message.trim()) return false;
    const priority = options.priority ?? TTSPriority.INFO;
    const now = Date.now();
    if (options.key) {
      const previous = this.lastSpokenAt.get(options.key);
      if (previous != null && now - previous < (options.cooldownMs ?? DEFAULT_COOLDOWN_MS)) return false;
    }
    try {
      const speaking = await Speech.isSpeaking();
      if (priority === TTSPriority.EMERGENCY || (priority === TTSPriority.HIGH && speaking && (this.activePriority ?? TTSPriority.INFO) < priority)) {
        await Speech.stop();
      } else if (speaking) return false;
      await Speech.speak(message, {
        ...this.nativeOptions(),
        ducking: priority >= TTSPriority.WARNING,
        silentMode: priority === TTSPriority.EMERGENCY ? 'ignore' : 'obey',
      });
      this.activePriority = priority;
      if (options.key) this.lastSpokenAt.set(options.key, now);
      return true;
    } catch (error) { console.warn('[TTS] speech failed', error); return false; }
  }

  async stop(): Promise<void> { try { await Speech.stop(); } catch (error) { console.warn('[TTS] stop failed', error); } }
  async isSpeaking(): Promise<boolean> { try { return await Speech.isSpeaking(); } catch { return false; } }

  announceRideStarted(groupCode?: string) {
    return this.speak('Ride started. Guardian Angel is active.', { key: `ride-started:${groupCode || 'current'}` });
  }
  announceRideEnded(groupCode?: string) { return this.speak('Ride ended.', { key: `ride-ended:${groupCode || 'current'}` }); }
  announceSeparation(riderId: string, riderName: string, distanceMeters?: number, isCurrentRider = false) {
    const key = `separation:${riderId}`;
    if (this.activeTransitions.has(key)) return Promise.resolve(false);
    this.activeTransitions.add(key);
    const distance = typeof distanceMeters === 'number' && Number.isFinite(distanceMeters)
      ? ` is ${Math.round(distanceMeters)} meters away from the group` : ' is separating from the group';
    return this.speak(isCurrentRider ? 'You are separating from the group.' : `${riderName}${distance}.`, {
      priority: TTSPriority.HIGH, key,
    });
  }
  announceReunion(riderId: string, riderName: string, isCurrentRider = false) {
    this.activeTransitions.delete(`separation:${riderId}`);
    this.lastSpokenAt.delete(`separation:${riderId}`);
    return this.speak(isCurrentRider ? 'You are back with the group.' : `${riderName} has rejoined the group.`, {
      key: `reunion:${riderId}`, cooldownMs: 15_000,
    });
  }
  announceSOS(riderId: string, riderName?: string, local = false, alarmId?: string) {
    return this.speak(local ? 'Emergency alert activated.' : `SOS received from ${riderName || 'another rider'}.`, {
      priority: TTSPriority.EMERGENCY, key: `sos:${alarmId || riderId}`, cooldownMs: 5 * 60_000,
    });
  }
  announceFallDetected() {
    return this.speak('A possible fall has been detected.', { priority: TTSPriority.EMERGENCY, key: 'fall:local' });
  }
  announceBreakdown(riderId: string, riderName: string, breakdownId?: string) {
    return this.speak(`${riderName} has reported a breakdown.`, { priority: TTSPriority.WARNING, key: `breakdown:${breakdownId || riderId}` });
  }
  announceBreakdownResolved(riderId: string, riderName: string, breakdownId?: string) {
    return this.speak(`${riderName}'s breakdown has been resolved.`, { key: `breakdown-resolved:${breakdownId || riderId}` });
  }
  announceRefuel(riderId: string, riderName: string, refillId?: string) {
    return this.speak(`${riderName} has stopped for fuel.`, { key: `refuel:${refillId || riderId}` });
  }
  announceDisconnect(riderId: string, riderName: string) {
    return this.speak(`Connection with ${riderName} has been lost.`, { priority: TTSPriority.WARNING, key: `disconnect:${riderId}` });
  }
  announceReconnect(riderId: string, riderName: string) {
    this.lastSpokenAt.delete(`disconnect:${riderId}`);
    return this.speak(`${riderName} has reconnected.`, { key: `reconnect:${riderId}` });
  }
  announceWeatherSnapshot(snapshot: WeatherSpeechSnapshot): Promise<void> {
    if (snapshot.isStale) return Promise.resolve();
    const supported = new Set(['HEAVY_RAIN', 'STRONG_WIND', 'STRONG_WIND_GUST', 'LOW_VISIBILITY', 'THUNDERSTORM', 'EXTREME_HEAT', 'EXTREME_COLD']);
    const active = new Set(snapshot.advisories.map(item => item.type).filter((type): type is string => Boolean(type && supported.has(type))));
    for (const type of this.activeWeatherAdvisories) {
      if (!active.has(type)) this.lastSpokenAt.delete(`weather:${type}`);
    }
    const newlyActive = [...active].filter(type => !this.activeWeatherAdvisories.has(type));
    this.activeWeatherAdvisories = active;

    const tasks: Array<Promise<boolean>> = [];
    if (snapshot.current && !this.weatherSummaryAnnounced) {
      this.weatherSummaryAnnounced = true;
      const temperature = typeof snapshot.current.temperatureC === 'number' && Number.isFinite(snapshot.current.temperatureC)
        ? `${Math.round(snapshot.current.temperatureC)} degrees with ` : '';
      tasks.push(this.speak(`Current weather is ${temperature}${this.weatherConditionLabel(snapshot.current.condition)} conditions.`, { key: 'weather:summary' }));
    }
    const priority = (type: string) => ['THUNDERSTORM', 'LOW_VISIBILITY', 'STRONG_WIND', 'STRONG_WIND_GUST'].includes(type) ? TTSPriority.HIGH : TTSPriority.WARNING;
    const selected = newlyActive.sort((a, b) => priority(b) - priority(a))[0];
    if (selected) tasks.push(this.speak(this.weatherAdvisoryMessage(selected), { priority: priority(selected), key: `weather:${selected}` }));
    return Promise.all(tasks).then(() => undefined);
  }
  resetWeatherTransitions(): void { this.activeWeatherAdvisories.clear(); this.weatherSummaryAnnounced = false; for (const key of [...this.lastSpokenAt.keys()]) if (key.startsWith('weather:')) this.lastSpokenAt.delete(key); }
  resetRideTransitions(): void { this.activeTransitions.clear(); this.lastSpokenAt.clear(); this.resetWeatherTransitions(); }

  private validateRate(rate: unknown): number {
    return typeof rate === 'number' && Number.isFinite(rate) ? Math.min(1.5, Math.max(0.5, rate)) : 1;
  }
  private nativeOptions() { return { rate: this.settings.rate, ...(this.settings.voiceId ? { voice: this.settings.voiceId } : {}) }; }
  private weatherConditionLabel(condition: string): string { return condition.replace(/_/g, ' ').trim() || 'unknown'; }
  private weatherAdvisoryMessage(type: string): string {
    return {
      HEAVY_RAIN: 'Weather update. Heavy rain is expected along your route.',
      STRONG_WIND: 'Warning. Strong winds are forecast along your route.',
      STRONG_WIND_GUST: 'Warning. Strong wind gusts are forecast along your route.',
      LOW_VISIBILITY: 'Warning. Low visibility is expected ahead. Ride with caution.',
      THUNDERSTORM: 'Warning. Thunderstorms are expected ahead. Consider delaying or pausing the ride.',
      EXTREME_HEAT: 'Weather update. Extreme heat is expected along your route. Hydrate and take breaks.',
      EXTREME_COLD: 'Weather update. Very cold conditions are expected along your route. Dress for the conditions.',
    }[type] || 'Weather update. Hazardous conditions are expected along your route.';
  }
  private configureNative(): void { try { Speech.configure(this.nativeOptions()); } catch (error) { console.warn('[TTS] configuration failed', error); } }
  private async restoreVoice(): Promise<void> {
    if (!this.settings.voiceId) return;
    const voices = await this.getVoices();
    if (!voices.some(voice => voice.identifier === this.settings.voiceId)) {
      this.settings = { ...this.settings, voiceId: null };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    }
  }
  private async persist(): Promise<void> {
    try { await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); }
    catch (error) { console.warn('[TTS] settings persistence failed', error); }
    this.notify();
  }
  private notify(): void { const snapshot = this.getSettings(); this.listeners.forEach(listener => listener(snapshot)); }
}

export const GuardianAngelTTS = new GuardianAngelTTSService();
export { DEFAULT_SETTINGS as DEFAULT_TTS_SETTINGS, SETTINGS_KEY as TTS_SETTINGS_KEY };
