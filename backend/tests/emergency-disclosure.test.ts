import { QueryRunner } from '../src/db/QueryRunner';
import { MedicalInfoService } from '../src/services/MedicalInfoService';
import { EmergencyDisclosureAuditService } from '../src/services/EmergencyDisclosureAuditService';

describe('GA-08 emergency medical disclosure', () => {
  const row = { blood_group: 'O+', allergies: 'Latex', emergency_contact_name: 'Alex', emergency_contact_phone: '+9779812345678', notes: 'Private notes', updated_at: new Date().toISOString() };
  it.each([
    ['both off', false, false, undefined], ['medical only', true, false, { blood_group: 'O+', allergies: 'Latex' }],
    ['contact only', false, true, { emergency_contact_name: 'Alex', emergency_contact_phone: '+9779812345678' }],
    ['both on', true, true, { blood_group: 'O+', allergies: 'Latex', emergency_contact_name: 'Alex', emergency_contact_phone: '+9779812345678' }],
  ])('discloses only consented fields when %s', async (_name, medical, contact, expected) => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...row, share_medical_during_emergency: medical, share_emergency_contact_during_emergency: contact }] });
    const snapshot = await new MedicalInfoService(new QueryRunner(query)).getMedicalInfoSnapshot('user-1');
    expect(snapshot).toEqual(expected);
    if (snapshot) expect(snapshot).not.toHaveProperty('notes');
  });
  it('writes disclosure audit metadata only and skips empty disclosure', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] }); const audit = new EmergencyDisclosureAuditService(new QueryRunner(query));
    await audit.record('user-1', 'room-1', 'alarm-1', ['medical_basic', 'emergency_contact']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO emergency_disclosure_audit'), ['user-1', 'room-1', 'alarm-1', '["medical_basic","emergency_contact"]']);
    expect(query.mock.calls[0][0]).not.toContain('blood_group');
    await audit.record('user-1', 'room-1', 'alarm-2', []);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
