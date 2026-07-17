// mobile/src/safety/crash/__tests__/crashDetector.test.ts
import { CrashDetector } from '../crashDetector';
import {
  generateCrashPattern,
  generateFalsePositivePattern,
  generateNormalRiding,
} from '../mocks/mockAccelerometerFeed';

jest.useFakeTimers();

describe('CrashDetector', () => {
  it('stays IDLE on normal riding data', () => {
    const detector = new CrashDetector();
    generateNormalRiding(30).forEach((r) => detector.feed(r));
    expect(detector.getState()).toBe('IDLE');
  });

  it('confirms a crash on impact + stillness pattern', () => {
    const detector = new CrashDetector();
    let crashFired = false;
    detector.onCrashDetected(() => {
      crashFired = true;
    });

    generateCrashPattern().forEach((r) => detector.feed(r));
    jest.advanceTimersByTime(3100); // past confirmWindowMs

    expect(crashFired).toBe(true);
    expect(detector.getState()).toBe('CRASH_CONFIRMED');
  });

  it('rejects a false positive (spike then normal motion resumes)', () => {
    const detector = new CrashDetector();
    let crashFired = false;
    detector.onCrashDetected(() => {
      crashFired = true;
    });

    generateFalsePositivePattern().forEach((r) => detector.feed(r));
    jest.advanceTimersByTime(3100);

    expect(crashFired).toBe(false);
    expect(detector.getState()).toBe('FALSE_POSITIVE');
  });

  it('resets to IDLE on manual reset (override button)', () => {
    const detector = new CrashDetector();
    generateCrashPattern().forEach((r) => detector.feed(r));
    detector.reset();
    expect(detector.getState()).toBe('IDLE');
  });
});