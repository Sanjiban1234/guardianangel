// mobile/src/safety/countdown/__tests__/countdownTimer.test.ts
import { CountdownTimer } from '../countdownTimer';

jest.useFakeTimers();

describe('CountdownTimer', () => {
  it('starts in IDLE state', () => {
    const timer = new CountdownTimer();
    expect(timer.getState()).toBe('IDLE');
  });

  it('transitions to RUNNING on start and sets remaining time', () => {
    const timer = new CountdownTimer({ durationMs: 5000, tickIntervalMs: 1000 });
    timer.start();
    expect(timer.getState()).toBe('RUNNING');
    expect(timer.getRemainingMs()).toBe(5000);
  });

  it('ticks down at the configured interval', () => {
    const timer = new CountdownTimer({ durationMs: 5000, tickIntervalMs: 1000 });
    const ticks: number[] = [];
    timer.onTick((remaining) => ticks.push(remaining));

    timer.start();
    jest.advanceTimersByTime(3000);

    expect(timer.getRemainingMs()).toBe(2000);
    expect(ticks).toContain(4000);
    expect(ticks).toContain(3000);
    expect(ticks).toContain(2000);
  });

  it('fires onExpire and transitions to EXPIRED when time runs out', () => {
    const timer = new CountdownTimer({ durationMs: 3000, tickIntervalMs: 1000 });
    let expired = false;
    timer.onExpire(() => {
      expired = true;
    });

    timer.start();
    jest.advanceTimersByTime(3000);

    expect(expired).toBe(true);
    expect(timer.getState()).toBe('EXPIRED');
    expect(timer.getRemainingMs()).toBe(0);
  });

  it('cancel() stops the timer and does NOT fire onExpire', () => {
    const timer = new CountdownTimer({ durationMs: 5000, tickIntervalMs: 1000 });
    let expired = false;
    timer.onExpire(() => {
      expired = true;
    });

    timer.start();
    jest.advanceTimersByTime(2000);
    timer.cancel();
    jest.advanceTimersByTime(5000); // even after full duration would've passed

    expect(expired).toBe(false);
    expect(timer.getState()).toBe('CANCELLED');
  });

  it('reset() returns timer to IDLE', () => {
    const timer = new CountdownTimer({ durationMs: 3000, tickIntervalMs: 1000 });
    timer.start();
    jest.advanceTimersByTime(3000); // let it expire
    timer.reset();

    expect(timer.getState()).toBe('IDLE');
    expect(timer.getRemainingMs()).toBe(0);
  });

  it('calling start() while already RUNNING is a no-op', () => {
    const timer = new CountdownTimer({ durationMs: 5000, tickIntervalMs: 1000 });
    timer.start();
    jest.advanceTimersByTime(2000);
    timer.start(); // should not reset remaining time
    expect(timer.getRemainingMs()).toBe(3000);
  });
});