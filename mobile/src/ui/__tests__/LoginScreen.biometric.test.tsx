import React from 'react';
import { Alert, Pressable, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import ReactNativeBiometrics from 'react-native-biometrics';
import { LoginScreen } from '../LoginScreen';
import * as SecureStore from '../utils/SecureStore';

jest.mock('../utils/SecureStore', () => ({
  clearBiometricLogin: jest.fn(),
  loadBiometricCredential: jest.fn(),
  saveBiometricCredential: jest.fn(),
}));

const loadBiometricCredential = SecureStore.loadBiometricCredential as jest.MockedFunction<typeof SecureStore.loadBiometricCredential>;
const clearBiometricLogin = SecureStore.clearBiometricLogin as jest.MockedFunction<typeof SecureStore.clearBiometricLogin>;
const biometricPrototype = ReactNativeBiometrics.prototype;
const androidSpkiBase64 = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwuEomOwJXyAhqcw6oe0g/5JzXeGkkGbcZU3hh9kvNgVWKv6v4jAE31YcZ7La6NdiNcqVFT8AqQLK7H6WoURiIqeHSUxSXII++CHWsYHKZSme+BIeECRPbphFPylWoCNjSqgJIFzgA3k3C1GCnC8iIGuLaI0gDo5xl+9tv0Mwc11SOvue0NOh+ODEj+5+2kgPxKCikahuivrXoxhSXYjsGY1a+vENLEMdY5zo2Y9kxg6bF7XOtxHz/856CqFy0lW9w1b/APd8oqAMq3k9UbMzz8yBfWONdlRstC5C/Kw3gYazpqDOIQZw0ss2dPxo28t3p3HYMhfANRsyMdR+QDXlnwIDAQAB';

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

const renderLogin = async () => {
  const onLoginSuccess = jest.fn();
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <LoginScreen apiBaseUrl="https://api.example" onLoginSuccess={onLoginSuccess} onNavigateToRegister={jest.fn()} />,
    );
  });
  await flush();
  return { renderer: renderer!, onLoginSuccess };
};

const textIn = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textIn).join('');
  if (value && typeof value === 'object' && 'props' in value) return textIn((value as { props: { children?: unknown } }).props.children);
  return '';
};

const pressables = (renderer: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance[] =>
  renderer.root.findAll(node => typeof node.props.onPress === 'function');

const biometricButton = (renderer: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance =>
  pressables(renderer).find(button => typeof button.props.accessibilityLabel === 'string' && button.props.accessibilityLabel.startsWith('Login with'))!;

const signInButton = (renderer: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance =>
  pressables(renderer).find(button => textIn(button.props.children).includes('Sign In'))!;

const beginPasswordLogin = async (renderer: TestRenderer.ReactTestRenderer): Promise<void> => {
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => {
    inputs[0].props.onChangeText('rider@example.com');
    inputs[1].props.onChangeText('password-SENTINEL');
  });
  await act(async () => { signInButton(renderer).props.onPress(); });
};

const enableFromPrompt = async (): Promise<void> => {
  const enableCall = (Alert.alert as jest.Mock).mock.calls.find(([title]) => title === 'Enable Biometric Login?');
  const enable = enableCall?.[2]?.find((button: { text: string }) => button.text === 'Enable');
  await act(async () => { await enable?.onPress(); });
};

const completeEnabledLogin = async (): Promise<void> => {
  const enabledCall = (Alert.alert as jest.Mock).mock.calls.find(([title]) => title === 'Biometric Login Enabled');
  const ok = enabledCall?.[2]?.find((button: { text: string }) => button.text === 'OK');
  await act(async () => { await ok?.onPress(); });
};

describe('LoginScreen biometric failure handling', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    logSpy = jest.spyOn(console, 'log').mockImplementation(jest.fn());
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(jest.fn());
    jest.spyOn(biometricPrototype, 'isSensorAvailable').mockResolvedValue({ available: true, biometryType: 'Biometrics' });
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: true });
    jest.spyOn(biometricPrototype, 'deleteKeys').mockResolvedValue({ keysDeleted: true });
    jest.spyOn(biometricPrototype, 'createKeys').mockResolvedValue({ publicKey: 'public-key' });
    jest.spyOn(biometricPrototype, 'createSignature').mockResolvedValue({ success: true, signature: 'signature' });
    loadBiometricCredential.mockResolvedValue({ credentialId: 'credential-1' });
    clearBiometricLogin.mockResolvedValue();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('keeps password login available when biometric hardware is unavailable', async () => {
    jest.spyOn(biometricPrototype, 'isSensorAvailable').mockResolvedValue({ available: false });
    const { renderer, onLoginSuccess } = await renderLogin();
    expect(pressables(renderer).some(button => textIn(button.props.children).includes('Login with'))).toBe(false);
    expect(renderer.toJSON()).toBeTruthy();
  });

  it('clears a stale local setup when its Android Keystore key was invalidated', async () => {
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const { renderer } = await renderLogin();
    expect(clearBiometricLogin).toHaveBeenCalledTimes(1);
    expect(pressables(renderer).some(button => textIn(button.props.children).includes('Login with'))).toBe(false);
  });

  it('reports no enrolled biometrics safely when enrollment changes before setup', async () => {
    jest.spyOn(biometricPrototype, 'isSensorAvailable')
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockResolvedValueOnce({ available: false, error: 'BIOMETRIC_ERROR_NONE_ENROLLED' });
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token-SENTINEL', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer, onLoginSuccess } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Biometric Enrollment Failed',
      expect.stringContaining('Set up a fingerprint or face'),
      expect.any(Array),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[BIOMETRIC CHECK UNAVAILABLE]', { category: 'biometric_not_enrolled' });
  });

  it('reports unavailable biometric hardware safely and does not create keys or call registration', async () => {
    jest.spyOn(biometricPrototype, 'isSensorAvailable')
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockResolvedValueOnce({ available: false, error: 'BIOMETRIC_ERROR_NO_HARDWARE' });
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const createKeys = jest.spyOn(biometricPrototype, 'createKeys');
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token-SENTINEL', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    expect(Alert.alert).toHaveBeenCalledWith('Biometric Enrollment Failed', expect.stringContaining('does not have biometric hardware'), expect.any(Array));
    expect(createKeys).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles a thrown availability check without logging the native exception', async () => {
    jest.spyOn(biometricPrototype, 'isSensorAvailable')
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockRejectedValueOnce(new Error('native failure containing token-SENTINEL'));
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token-SENTINEL', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    expect(warnSpy).toHaveBeenCalledWith('[BIOMETRIC ENROLLMENT FAILED]', { category: 'biometric_check_failed' });
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('token-SENTINEL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('continues secure enrollment after an available sensor and logs only diagnostic fields', async () => {
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const createKeys = jest.spyOn(biometricPrototype, 'createKeys').mockResolvedValue({ publicKey: androidSpkiBase64 });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token-SENTINEL', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ credential_id: 'credential-SENTINEL' }) });

    const { renderer, onLoginSuccess } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    expect(createKeys).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example/api/auth/biometric/register');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer access-token-SENTINEL', 'Content-Type': 'application/json' },
    }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      public_key: expect.stringMatching(/^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/]{64}\n)+[A-Za-z0-9+/]+={0,2}\n-----END PUBLIC KEY-----\n$/),
    });
    expect(SecureStore.saveBiometricCredential).toHaveBeenCalledWith({ credentialId: 'credential-SENTINEL' });
    expect(logSpy).toHaveBeenCalledWith('[BIOMETRIC CHECK]', {
      available: true,
      biometryType: 'Biometrics',
      error: null,
    });
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain('SENTINEL');
    expect(Alert.alert).not.toHaveBeenCalledWith('Biometric Enrollment Failed', expect.anything(), expect.any(Array));
    await completeEnabledLogin();
    expect(onLoginSuccess).toHaveBeenCalledWith('access-token-SENTINEL', expect.objectContaining({ id: 'rider-1' }));
  });

  it('replaces an existing key before generating and registering a new key', async () => {
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist')
      .mockResolvedValueOnce({ keysExist: false })
      .mockResolvedValueOnce({ keysExist: false })
      .mockResolvedValueOnce({ keysExist: true });
    const deleteKeys = jest.spyOn(biometricPrototype, 'deleteKeys').mockResolvedValue({ keysDeleted: true });
    const createKeys = jest.spyOn(biometricPrototype, 'createKeys').mockResolvedValue({ publicKey: 'public-key-SENTINEL' });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ credential_id: 'credential-SENTINEL' }) });

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    expect(deleteKeys).toHaveBeenCalledTimes(1);
    expect(createKeys).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['key_check', 'biometric_key_check_failed', () => {
      jest.spyOn(biometricPrototype, 'biometricKeysExist')
        .mockResolvedValueOnce({ keysExist: false })
        .mockResolvedValueOnce({ keysExist: false })
        .mockRejectedValueOnce(new Error('key check token-SENTINEL'));
    }],
    ['key_delete', 'biometric_key_delete_failed', () => {
      jest.spyOn(biometricPrototype, 'biometricKeysExist')
        .mockResolvedValueOnce({ keysExist: false })
        .mockResolvedValueOnce({ keysExist: false })
        .mockResolvedValueOnce({ keysExist: true });
      jest.spyOn(biometricPrototype, 'deleteKeys').mockRejectedValue(new Error('key delete token-SENTINEL'));
    }],
    ['key_generation', 'biometric_key_generation_failed', () => {
      jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
      jest.spyOn(biometricPrototype, 'createKeys').mockRejectedValue(new Error('key generation token-SENTINEL'));
    }],
  ])('shows a safe %s failure diagnostic', async (stage, category, setup) => {
    loadBiometricCredential.mockResolvedValue(null);
    setup();
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    const message = (Alert.alert as jest.Mock).mock.calls.find(([title]) => title === 'Biometric Enrollment Failed')?.[1] as string;
    expect(message).toContain(`stage: ${stage}`);
    expect(message).toContain('status: null');
    expect(message).not.toContain('token-SENTINEL');
    expect(warnSpy).toHaveBeenCalledWith('[BIOMETRIC ENROLLMENT FAILED]', { category });
  });

  it.each([
    ['backend_registration', { ok: false, status: 503, json: async () => ({ error: 'ignored' }) }, 'biometric_register_failed'],
    ['credential_validation', { ok: true, status: 201, json: async () => ({}) }, 'biometric_register_failed'],
  ])('shows a safe %s diagnostic for registration failures', async (stage, registrationResponse, category) => {
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    jest.spyOn(biometricPrototype, 'createKeys').mockResolvedValue({ publicKey: 'public-key-SENTINEL' });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) })
      .mockResolvedValueOnce(registrationResponse);

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    const message = (Alert.alert as jest.Mock).mock.calls.find(([title]) => title === 'Biometric Enrollment Failed')?.[1] as string;
    expect(message).toContain(`stage: ${stage}`);
    expect(warnSpy).toHaveBeenCalledWith(
      '[BIOMETRIC ENROLLMENT FAILED]',
      stage === 'backend_registration' ? { category, status: 503 } : { category },
    );
  });

  it('shows a safe credential_save diagnostic when storing the credential fails', async () => {
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    jest.spyOn(biometricPrototype, 'createKeys').mockResolvedValue({ publicKey: 'public-key-SENTINEL' });
    (SecureStore.saveBiometricCredential as jest.Mock).mockRejectedValue(new Error('credential token-SENTINEL'));
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ credential_id: 'credential-SENTINEL' }) });

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);
    await enableFromPrompt();

    const message = (Alert.alert as jest.Mock).mock.calls.find(([title]) => title === 'Biometric Enrollment Failed')?.[1] as string;
    expect(message).toContain('stage: credential_save');
    expect(message).not.toContain('token-SENTINEL');
    expect(warnSpy).toHaveBeenCalledWith('[BIOMETRIC ENROLLMENT FAILED]', { category: 'biometric_credential_save_failed' });
  });

  it('shows enrollment when password login finishes before the mount-time check and the fresh check is available', async () => {
    let resolveMountCheck!: (value: Awaited<ReturnType<typeof biometricPrototype.isSensorAvailable>>) => void;
    jest.spyOn(biometricPrototype, 'isSensorAvailable')
      .mockImplementationOnce(() => new Promise<Awaited<ReturnType<typeof biometricPrototype.isSensorAvailable>>>(resolve => { resolveMountCheck = resolve; }))
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' });
    loadBiometricCredential.mockResolvedValue(null);
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);

    expect(Alert.alert).toHaveBeenCalledWith('Enable Biometric Login?', expect.any(String), expect.any(Array));
    resolveMountCheck({ available: true });
    await flush();
  });

  it('continues normal login without enrollment when the fresh post-login check is unavailable', async () => {
    jest.spyOn(biometricPrototype, 'isSensorAvailable')
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockResolvedValueOnce({ available: false, error: 'BIOMETRIC_ERROR_HW_UNAVAILABLE' });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'normal-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer, onLoginSuccess } = await renderLogin();
    await beginPasswordLogin(renderer);

    expect(Alert.alert).not.toHaveBeenCalledWith('Enable Biometric Login?', expect.anything(), expect.anything());
    expect(onLoginSuccess).toHaveBeenCalledWith('normal-token', expect.objectContaining({ id: 'rider-1' }));
  });

  it('suppresses enrollment when the fresh post-login check finds complete setup', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'normal-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer, onLoginSuccess } = await renderLogin();
    await beginPasswordLogin(renderer);

    expect(Alert.alert).not.toHaveBeenCalledWith('Enable Biometric Login?', expect.anything(), expect.anything());
    expect(onLoginSuccess).toHaveBeenCalledWith('normal-token', expect.objectContaining({ id: 'rider-1' }));
  });

  it('clears a stale credential during the fresh check and offers enrollment', async () => {
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'access-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer } = await renderLogin();
    await beginPasswordLogin(renderer);

    expect(clearBiometricLogin).toHaveBeenCalledTimes(2);
    expect(Alert.alert).toHaveBeenCalledWith('Enable Biometric Login?', expect.any(String), expect.any(Array));
  });

  it('continues normal login safely when the fresh availability check throws', async () => {
    jest.spyOn(biometricPrototype, 'isSensorAvailable')
      .mockResolvedValueOnce({ available: true, biometryType: 'Biometrics' })
      .mockRejectedValueOnce(new Error('native failure containing token-SENTINEL'));
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'normal-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });

    const { renderer, onLoginSuccess } = await renderLogin();
    await beginPasswordLogin(renderer);

    expect(Alert.alert).not.toHaveBeenCalledWith('Enable Biometric Login?', expect.anything(), expect.anything());
    expect(onLoginSuccess).toHaveBeenCalledWith('normal-token', expect.objectContaining({ id: 'rider-1' }));
    expect(warnSpy).toHaveBeenCalledWith('[BIOMETRIC CHECK FAILED]', { category: 'biometric_check_failed' });
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('token-SENTINEL');
  });

  it('does not authenticate, retry, or clear setup when the biometric prompt is cancelled', async () => {
    jest.spyOn(biometricPrototype, 'createSignature').mockResolvedValue({ success: false });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: 'challenge-value' }) });
    const { renderer, onLoginSuccess } = await renderLogin();
    await act(async () => { biometricButton(renderer).props.onPress(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onLoginSuccess).not.toHaveBeenCalled();
    expect(clearBiometricLogin).not.toHaveBeenCalled();
  });

  it('restores the returned normal session only after a successful challenge, signature, and verification', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: 'challenge-value' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'normal-session-token', user: { id: 'rider-1', name: 'Rider', email: 'rider@example.com', profile_complete: true } }) });
    const { renderer, onLoginSuccess } = await renderLogin();
    await act(async () => { biometricButton(renderer).props.onPress(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onLoginSuccess).toHaveBeenCalledWith('normal-session-token', expect.objectContaining({ id: 'rider-1' }));
  });

  it('clears local setup and falls back to password login after the server rejects biometric verification', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: 'challenge-value' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Biometric login failed' }) });
    const { renderer, onLoginSuccess } = await renderLogin();
    await act(async () => { biometricButton(renderer).props.onPress(); });
    expect(clearBiometricLogin).toHaveBeenCalledTimes(1);
    expect(onLoginSuccess).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Biometric Login Unavailable', expect.any(String));
  });
});
