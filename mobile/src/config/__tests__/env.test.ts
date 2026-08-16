import { Platform } from 'react-native';
import { getApiBaseUrl } from '../env';

describe('API Base URL Configuration', () => {  afterEach(() => {
    // Use `delete` so the var is truly unset (Node stringifies `= undefined` to "undefined")
    delete (process.env as any).API_BASE_URL;
  });

  it('uses process.env.API_BASE_URL when defined', () => {
    process.env.API_BASE_URL = 'http://192.168.1.150:3000';
    expect(getApiBaseUrl()).toBe('http://192.168.1.150:3000');
  });

  it('trims trailing slashes from API_BASE_URL', () => {
    process.env.API_BASE_URL = 'http://192.168.1.150:3000///';
    expect(getApiBaseUrl()).toBe('http://192.168.1.150:3000');
  });

  it('falls back to Railway production backend for Android when API_BASE_URL is not set', () => {
    delete (process.env as any).API_BASE_URL;
    (Platform as { OS: string }).OS = 'android';
    expect(getApiBaseUrl()).toBe('https://joyful-growth-production.up.railway.app');
  });

  it('falls back to Railway production backend for non-Android platforms when API_BASE_URL is not set', () => {
    delete (process.env as any).API_BASE_URL;
    (Platform as { OS: string }).OS = 'ios';
    expect(getApiBaseUrl()).toBe('https://joyful-growth-production.up.railway.app');
  });
});
