import React from 'react';
import { Alert, Pressable } from 'react-native';
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
  pressables(renderer).find(button => textIn(button.props.children).includes('Login with'))!;

describe('LoginScreen biometric failure handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    jest.spyOn(biometricPrototype, 'isSensorAvailable').mockResolvedValue({ available: true, biometryType: 'Biometrics' });
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: true });
    jest.spyOn(biometricPrototype, 'createSignature').mockResolvedValue({ success: true, signature: 'signature' });
    loadBiometricCredential.mockResolvedValue({ credentialId: 'credential-1' });
    clearBiometricLogin.mockResolvedValue();
    global.fetch = jest.fn();
  });

  it('keeps password login available when biometric hardware is unavailable', async () => {
    jest.spyOn(biometricPrototype, 'isSensorAvailable').mockResolvedValue({ available: false });
    const { renderer } = await renderLogin();
    expect(pressables(renderer).some(button => textIn(button.props.children).includes('Login with'))).toBe(false);
    expect(renderer.toJSON()).toBeTruthy();
  });

  it('clears a stale local setup when its Android Keystore key was invalidated', async () => {
    jest.spyOn(biometricPrototype, 'biometricKeysExist').mockResolvedValue({ keysExist: false });
    const { renderer } = await renderLogin();
    expect(clearBiometricLogin).toHaveBeenCalledTimes(1);
    expect(pressables(renderer).some(button => textIn(button.props.children).includes('Login with'))).toBe(false);
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
