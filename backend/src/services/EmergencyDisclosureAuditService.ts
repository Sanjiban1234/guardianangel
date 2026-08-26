import { QueryRunner } from '../db/QueryRunner';

export class EmergencyDisclosureAuditService {
  constructor(private readonly db: QueryRunner) {}
  async record(subjectUserId: string, roomId: string | null, incidentId: string, categories: string[]): Promise<void> {
    if (!categories.length) return;
    await this.db.run(
      `INSERT INTO emergency_disclosure_audit (subject_user_id, room_id, incident_type, incident_id, categories_disclosed, recipient_scope)
       VALUES ($1, $2, 'sos', $3, $4::jsonb, 'active_room_members')`,
      [subjectUserId, roomId, incidentId, JSON.stringify(categories)],
    );
  }
}
