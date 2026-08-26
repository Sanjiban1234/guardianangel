import { QueryRunner } from '../db/QueryRunner';
import type { MedicalInfoSnapshot } from '@guardian-angel/contracts/websocket-events';

export type BloodGroup =
  | 'A+'
  | 'A-'
  | 'B+'
  | 'B-'
  | 'AB+'
  | 'AB-'
  | 'O+'
  | 'O-';

export interface MedicalInfoData {
  blood_group?: BloodGroup | null;
  allergies?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null;
  share_medical_during_emergency?: boolean;
  share_emergency_contact_during_emergency?: boolean;
  updated_at?: number;
}

const VALID_BLOOD_GROUPS: string[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

/** Normalize a Nepali local number (10-digit starting with 9) to E.164. */
const normalizePhone = (phone: string): string =>
  /^9\d{9}$/.test(phone) ? `+977${phone}` : phone;

export class MedicalInfoService {
  constructor(private readonly db: QueryRunner) {}

  /**
   * Upsert medical information for a user.
   */
  async upsertMedicalInfo(
    userId: string,
    data: MedicalInfoData
  ): Promise<MedicalInfoData> {
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid medical information payload');
    const allowed = new Set(['blood_group', 'allergies', 'emergency_contact_name', 'emergency_contact_phone', 'notes', 'share_medical_during_emergency', 'share_emergency_contact_during_emergency']);
    if (Object.keys(data as object).some((key) => !allowed.has(key))) throw new Error('Unknown medical information field');
    for (const key of ['allergies', 'emergency_contact_name', 'emergency_contact_phone', 'notes'] as const) {
      const value = data[key];
      if (value != null && typeof value !== 'string') throw new Error(`Invalid ${key}`);
    }
    for (const key of ['share_medical_during_emergency', 'share_emergency_contact_during_emergency'] as const) {
      if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error(`Invalid ${key}`);
    }
    if ((data.allergies?.length || 0) > 500 || (data.emergency_contact_name?.length || 0) > 100 || (data.emergency_contact_phone?.length || 0) > 20 || (data.notes?.length || 0) > 1000) throw new Error('Medical information exceeds maximum length');
    const rawBloodGroup = data.blood_group as string | null | undefined;
    if (rawBloodGroup !== undefined && rawBloodGroup !== null && rawBloodGroup !== '') {
      if (!VALID_BLOOD_GROUPS.includes(rawBloodGroup)) {
        throw new Error(
          `Invalid blood group: ${rawBloodGroup}. Must be one of: ${VALID_BLOOD_GROUPS.join(', ')}`
        );
      }
    }

    if (
      data.emergency_contact_phone !== undefined &&
      data.emergency_contact_phone !== null &&
      data.emergency_contact_phone.trim() !== ''
    ) {
      const normalizedContactPhone = normalizePhone(data.emergency_contact_phone.trim());
      if (!E164_PHONE_REGEX.test(normalizedContactPhone)) {
        throw new Error('Invalid emergency contact phone number. Use E.164 (e.g. +9779812345678) or a 10-digit Nepali number (e.g. 9812345678)');
      }
      data = { ...data, emergency_contact_phone: normalizedContactPhone };
    }

    const bloodGroup = data.blood_group || null;
    const allergies = data.allergies !== undefined && data.allergies !== null ? data.allergies.trim() : null;
    const contactName = data.emergency_contact_name !== undefined && data.emergency_contact_name !== null ? data.emergency_contact_name.trim() : null;
    const contactPhone = data.emergency_contact_phone !== undefined && data.emergency_contact_phone !== null ? data.emergency_contact_phone.trim() : null;
    const notes = data.notes !== undefined && data.notes !== null ? data.notes.trim() : null;

    const result = await this.db.run(
      `INSERT INTO medical_info (user_id, blood_group, allergies, emergency_contact_name, emergency_contact_phone, notes, share_medical_during_emergency, share_emergency_contact_during_emergency, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET blood_group = EXCLUDED.blood_group,
           allergies = EXCLUDED.allergies,
           emergency_contact_name = EXCLUDED.emergency_contact_name,
           emergency_contact_phone = EXCLUDED.emergency_contact_phone,
           notes = EXCLUDED.notes, share_medical_during_emergency = EXCLUDED.share_medical_during_emergency, share_emergency_contact_during_emergency = EXCLUDED.share_emergency_contact_during_emergency,
           updated_at = NOW()
       RETURNING blood_group, allergies, emergency_contact_name, emergency_contact_phone, notes, share_medical_during_emergency, share_emergency_contact_during_emergency, updated_at`,
      [userId, bloodGroup, allergies, contactName, contactPhone, notes, data.share_medical_during_emergency === true, data.share_emergency_contact_during_emergency === true]
    );

    const row = result.rows[0];
    return {
      blood_group: row.blood_group || undefined,
      allergies: row.allergies || undefined,
      emergency_contact_name: row.emergency_contact_name || undefined,
      emergency_contact_phone: row.emergency_contact_phone || undefined,
      notes: row.notes || undefined,
      share_medical_during_emergency: row.share_medical_during_emergency === true,
      share_emergency_contact_during_emergency: row.share_emergency_contact_during_emergency === true,
      updated_at: new Date(row.updated_at).getTime(),
    };
  }

  /**
   * Retrieve medical information for a user.
   */
  async getMedicalInfo(userId: string): Promise<MedicalInfoData | null> {
    const result = await this.db.run(
      `SELECT blood_group, allergies, emergency_contact_name, emergency_contact_phone, notes, share_medical_during_emergency, share_emergency_contact_during_emergency, updated_at
       FROM medical_info
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      blood_group: row.blood_group || undefined,
      allergies: row.allergies || undefined,
      emergency_contact_name: row.emergency_contact_name || undefined,
      emergency_contact_phone: row.emergency_contact_phone || undefined,
      notes: row.notes || undefined,
      share_medical_during_emergency: row.share_medical_during_emergency === true,
      share_emergency_contact_during_emergency: row.share_emergency_contact_during_emergency === true,
      updated_at: new Date(row.updated_at).getTime(),
    };
  }

  /**
   * Delete medical information record for a user.
   */
  async deleteMedicalInfo(userId: string): Promise<boolean> {
    const result = await this.db.run(
      `DELETE FROM medical_info WHERE user_id = $1 RETURNING user_id`,
      [userId]
    );
    return result.rows.length > 0;
  }

  /**
   * Fetch medical info snapshot formatted for alert payloads.
   */
  async getMedicalInfoSnapshot(userId: string): Promise<MedicalInfoSnapshot | undefined> {
    const info = await this.getMedicalInfo(userId);
    if (!info) return undefined;

    const snapshot: MedicalInfoSnapshot = {};
    let hasData = false;

    if (info.share_medical_during_emergency && info.blood_group) {
      snapshot.blood_group = info.blood_group;
      hasData = true;
    }
    if (info.share_medical_during_emergency && info.allergies) {
      snapshot.allergies = info.allergies;
      hasData = true;
    }
    if (info.share_emergency_contact_during_emergency && info.emergency_contact_name) {
      snapshot.emergency_contact_name = info.emergency_contact_name;
      hasData = true;
    }
    if (info.share_emergency_contact_during_emergency && info.emergency_contact_phone) {
      snapshot.emergency_contact_phone = info.emergency_contact_phone;
      hasData = true;
    }

    return hasData ? snapshot : undefined;
  }
}
