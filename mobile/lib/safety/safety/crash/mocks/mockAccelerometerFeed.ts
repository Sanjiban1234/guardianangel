// mobile/src/safety/crash/mocks/mockAccelerometerFeed.ts
import { AccelerometerReading } from '../types';

// Normal riding vibration: small noise around gravity baseline
export function generateNormalRiding(count = 20, startTs = Date.now()): AccelerometerReading[] {
  const readings: AccelerometerReading[] = [];
  for (let i = 0; i < count; i++) {
    readings.push({
      x: (Math.random() - 0.5) * 1.5,
      y: (Math.random() - 0.5) * 1.5,
      z: 9.8 + (Math.random() - 0.5) * 1.5,
      timestamp: startTs + i * 100,
    });
  }
  return readings;
}

// Crash: spike then stillness (device on the ground)
export function generateCrashPattern(startTs = Date.now()): AccelerometerReading[] {
  const readings = generateNormalRiding(10, startTs);
  const impactTs = startTs + 1000;
  readings.push({ x: 30, y: 15, z: 20, timestamp: impactTs }); // impact spike
  for (let i = 1; i <= 15; i++) {
    readings.push({
      x: 0.05 * (Math.random() - 0.5),
      y: 0.05 * (Math.random() - 0.5),
      z: 9.8, // lying flat/still after impact
      timestamp: impactTs + i * 100,
    });
  }
  return readings;
}

// Dropped phone, not a crash: spike then normal motion resumes
export function generateFalsePositivePattern(startTs = Date.now()): AccelerometerReading[] {
  const readings = generateNormalRiding(10, startTs);
  const impactTs = startTs + 1000;
  readings.push({ x: 28, y: 10, z: 18, timestamp: impactTs });
  readings.push(...generateNormalRiding(15, impactTs + 100));
  return readings;
}