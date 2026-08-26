import { redactLogValue } from '../src/utils/logger';

describe('production log redaction', () => {
  it('redacts sensitive fields recursively', () => {
    const secret = 'do-not-log';
    const result = redactLogValue({ password: secret, nested: { token: secret, latitude: 27.7, longitude: 85.3, group_code: 'ABC123', socket_id: 'socket-secret', user_id: 'user-secret', email: 'rider@example.test', allergies: 'latex', notes: 'private', emergency_contact_phone: '+9770000000000', DATABASE_URL: secret } });
    const output = JSON.stringify(result);
    expect(output).not.toContain(secret);
    expect(output).not.toContain('27.7');
    expect(output).not.toContain('85.3');
    expect(output).not.toContain('ABC123');
    expect(output).not.toContain('latex');
    expect(output).not.toContain('private');
    expect(output).not.toContain('socket-secret');
    expect(output).not.toContain('user-secret');
    expect(output).not.toContain('rider@example.test');
  });
});
