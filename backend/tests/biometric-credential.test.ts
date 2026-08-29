import crypto from 'crypto';
import * as db from '../src/db';
import { QueryRunner } from '../src/db/QueryRunner';
import { BiometricCredentialService } from '../src/services/BiometricCredentialService';

jest.mock('../src/db', () => ({ query: jest.fn(), initDb: jest.fn(), pool: { connect: jest.fn() } }));

const query = db.query as jest.MockedFunction<typeof db.query>;
const credentialId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const challenge = 'a'.repeat(43);
const challengeHash = crypto.createHash('sha256').update(challenge).digest('hex');
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const androidSpkiBase64 = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const publicKey = `-----BEGIN PUBLIC KEY-----\n${androidSpkiBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----\n`;

describe('BiometricCredentialService', () => {
  let service: BiometricCredentialService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BiometricCredentialService(new QueryRunner());
  });

  it('atomically replaces an active credential, preserving the one-active-credential invariant', async () => {
    query.mockResolvedValue({ rows: [{ id: credentialId }] });
    await expect(service.register(userId, publicKey)).resolves.toBe(credentialId);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id) WHERE revoked_at IS NULL'), expect.arrayContaining([userId, publicKey]));
  });

  it.each(['not a public key', 'x'.repeat(8_193)])('rejects malformed or oversized public keys', async (publicKeyValue) => {
    await expect(service.register(userId, publicKeyValue)).rejects.toThrow('Invalid biometric public key');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an unsupported non-RSA public key', async () => {
    const unsupportedKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey
      .export({ type: 'spki', format: 'pem' }).toString();
    await expect(service.register(userId, unsupportedKey)).rejects.toThrow('Invalid biometric public key');
    expect(query).not.toHaveBeenCalled();
  });

  it('issues a cryptographically random challenge only for an active credential', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: credentialId }] });
    const issued = await service.createChallenge(credentialId);
    expect(issued?.credentialId).toBe(credentialId);
    expect(issued?.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INTERVAL '5 minutes'"), expect.arrayContaining([credentialId]));
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.createChallenge(credentialId)).resolves.toBeNull();
  });

  it('accepts a matching RSA-SHA256 signature once and consumes the challenge', async () => {
    const signature = crypto.sign('RSA-SHA256', Buffer.from(challenge), keyPair.privateKey).toString('base64');
    query.mockResolvedValueOnce({ rows: [{ id: credentialId, user_id: userId, public_key: publicKey, challenge_hash: challengeHash }] });
    query.mockResolvedValueOnce({ rows: [{ user_id: userId }] });

    await expect(service.verifyAndConsume(credentialId, challenge, signature)).resolves.toBe(userId);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('challenge_hash = NULL'), [credentialId, challengeHash]);
  });

  it('rejects a signature for another challenge and a replay whose atomic consume loses the race', async () => {
    const wrongSignature = crypto.sign('RSA-SHA256', Buffer.from('b'.repeat(43)), keyPair.privateKey).toString('base64');
    query.mockResolvedValueOnce({ rows: [{ id: credentialId, user_id: userId, public_key: publicKey, challenge_hash: challengeHash }] });
    await expect(service.verifyAndConsume(credentialId, challenge, wrongSignature)).resolves.toBeNull();

    const correctSignature = crypto.sign('RSA-SHA256', Buffer.from(challenge), keyPair.privateKey).toString('base64');
    query.mockResolvedValueOnce({ rows: [{ id: credentialId, user_id: userId, public_key: publicKey, challenge_hash: challengeHash }] });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.verifyAndConsume(credentialId, challenge, correctSignature)).resolves.toBeNull();
  });
});
