import AsyncStorage from '@react-native-async-storage/async-storage';
import { ITelemetryDatabase, TelemetryReading } from '../types';

const PREFIX = '@guardianangel/telemetry/v1/';
const keyFor = (r: TelemetryReading) => `${PREFIX}${encodeURIComponent(r.userId!)}/${r.client_reading_id}`;

/** One atomic value per sample; no shared JSON queue that concurrent writes can overwrite.
 * Uses the installed native AsyncStorage adapter. Pending samples are never age/cap purged.
 * Uploaded records are deleted immediately, bounding storage to undelivered history. */
export class DurableTelemetryDatabase implements ITelemetryDatabase {
  constructor(private readonly storage = AsyncStorage) {}
  async init(): Promise<void> {}
  async insertReading(reading: TelemetryReading): Promise<void> {
    if (!reading.userId || !reading.groupCode || !reading.client_reading_id) throw new Error('Telemetry scope required');
    await this.storage.setItem(keyFor(reading), JSON.stringify(reading));
  }
  async getUnsyncedReadings(limit = 100, userId?: string, excludedGroupCodes: string[] = []): Promise<TelemetryReading[]> {
    if (!userId) return [];
    const prefix = `${PREFIX}${encodeURIComponent(userId)}/`;
    const keys = (await this.storage.getAllKeys()).filter(k => k.startsWith(prefix));
    let oldest: TelemetryReading[] = [];
    // Read chunks to bound bridge payloads and yield between chunks.
    for (let i = 0; i < keys.length; i += 100) {
      for (const [, value] of Object.entries(await this.storage.getMany(keys.slice(i, i + 100)))) {
        try {
          const r = JSON.parse(value || 'null');
          if (r?.userId === userId && r.groupCode && !r.synced && !excludedGroupCodes.includes(r.groupCode)) oldest.push(r);
        } catch { console.warn('[TELEMETRY] unreadable pending record retained'); }
      }
      oldest.sort((a, b) => a.timestamp - b.timestamp || a.client_reading_id.localeCompare(b.client_reading_id));
      oldest = oldest.slice(0, limit);
    }
    return oldest;
  }
  async markReadingsSynced(ids: string[]): Promise<void> {
    const wanted = new Set(ids);
    const keys = (await this.storage.getAllKeys()).filter(k => k.startsWith(PREFIX) && wanted.has(k.slice(k.lastIndexOf('/') + 1)));
    if (keys.length) await this.storage.removeMany(keys);
  }
  async getUnsyncedCount(): Promise<number> {
    return (await this.storage.getAllKeys()).filter(k => k.startsWith(PREFIX)).length;
  }
  async clear(): Promise<void> { throw new Error('Pending telemetry must only be removed after acknowledgement'); }
}
