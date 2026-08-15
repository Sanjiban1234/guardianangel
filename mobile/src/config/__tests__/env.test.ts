import { Platform } from 'react-native';
import { getApiBaseUrl } from '../env';

describe('API Base URL Configuration', () => {
  const originalEnv = process.env.API_BASE_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      (process.env as any).API_BASE_URL = undefined;
    } else {
      process.env.API_BASE_URL = originalEnv;
    }
  });

  it('uses process.env.API_BASE_URL when defined', () => {
    process.env.API_BASE_URL = 'http://192.168.1.150:3000';
    expect(getApiBaseUrl()).toBe('http://192.168.1.150:3000');
  });

  it('trims trailing slashes from API_BASE_URL', () => {
    process.env.API_BASE_URL = 'http://192.168.1.150:3000///';
    expect(getApiBaseUrl()).toBe('http://192.168.1.150:3000');
  });

  it('falls back to 10.0.2.2 for Android when API_BASE_URL is not set', () => {
    (process.env as any).API_BASE_URL = undefined;
    (Platform as { OS: string }).OS = 'android';
    expect(getApiBaseUrl()).toBe('http://10.0.2.2:3000');
  });

  it('falls back to localhost for non-Android platforms when API_BASE_URL is not set', () => {
    (process.env as any).API_BASE_URL = undefined;
    (Platform as { OS: string }).OS = 'ios';
    expect(getApiBaseUrl()).toBe('http://localhost:3000');
  });
});
