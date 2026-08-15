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
      `INSERT INTO medical_info (user_id, blood_group, allergies, emergency_contact_name, emergency_contact_phone, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET blood_group = EXCLUDED.blood_group,
           allergies = EXCLUDED.allergies,
           emergency_contact_name = EXCLUDED.emergency_contact_name,
           emergency_contact_phone = EXCLUDED.emergency_contact_phone,
           notes = EXCLUDED.notes,
           updated_at = NOW()
       RETURNING blood_group, allergies, emergency_contact_name, emergency_contact_phone, notes, updated_at`,
      [userId, bloodGroup, allergies, contactName, contactPhone, notes]
    );

    const row = result.rows[0];
    return {
      blood_group: row.blood_group || undefined,
      allergies: row.allergies || undefined,
      emergency_contact_name: row.emergency_contact_name || undefined,
      emergency_contact_phone: row.emergency_contact_phone || undefined,
      notes: row.notes || undefined,
      updated_at: new Date(row.updated_at).getTime(),
    };
  }

  /**
   * Retrieve medical information for a user.
   */
  async getMedicalInfo(userId: string): Promise<MedicalInfoData | null> {
    const result = await this.db.run(
      `SELECT blood_group, allergies, emergency_contact_name, emergency_contact_phone, notes, updated_at
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

    if (info.blood_group) {
      snapshot.blood_group = info.blood_group;
      hasData = true;
    }
    if (info.allergies) {
      snapshot.allergies = info.allergies;
      hasData = true;
    }
    if (info.emergency_contact_name) {
      snapshot.emergency_contact_name = info.emergency_contact_name;
      hasData = true;
    }
    if (info.emergency_contact_phone) {
      snapshot.emergency_contact_phone = info.emergency_contact_phone;
      hasData = true;
    }
    if (info.notes) {
      snapshot.notes = info.notes;
      hasData = true;
    }

    return hasData ? snapshot : undefined;
  }
}
