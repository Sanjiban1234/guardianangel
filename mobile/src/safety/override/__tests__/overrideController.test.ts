// mobile/src/safety/override/__tests__/overrideController.test.ts
import { OverrideController } from '../overrideController';

function makeDeps(countdownState: string) {
  return {
    cancelCountdown: jest.fn(),
    resetCrashDetector: jest.fn(),
    getCountdownState: jest.fn(() => countdownState),
  };
}

describe('OverrideController', () => {
  it('cancels countdown and resets detector when countdown is RUNNING', () => {
    const deps = makeDeps('RUNNING');
    const controller = new OverrideController(deps);

    const result = controller.trigger();

    expect(result).toBe('OVERRIDDEN');
    expect(deps.cancelCountdown).toHaveBeenCalledTimes(1);
    expect(deps.resetCrashDetector).toHaveBeenCalledTimes(1);
  });

  it('does nothing when countdown is IDLE (no crash detected)', () => {
    const deps = makeDeps('IDLE');
    const controller = new OverrideController(deps);

    const result = controller.trigger();

    expect(result).toBe('NOT_APPLICABLE');
    expect(deps.cancelCountdown).not.toHaveBeenCalled();
    expect(deps.resetCrashDetector).not.toHaveBeenCalled();
  });

  it('does nothing when countdown already EXPIRED (alert already fired)', () => {
    const deps = makeDeps('EXPIRED');
    const controller = new OverrideController(deps);

    const result = controller.trigger();

    expect(result).toBe('NOT_APPLICABLE');
    expect(deps.cancelCountdown).not.toHaveBeenCalled();
  });

  it('notifies listeners with the result', () => {
    const deps = makeDeps('RUNNING');
    const controller = new OverrideController(deps);
    const results: string[] = [];
    controller.onOverride((r) => results.push(r));

    controller.trigger();

    expect(results).toEqual(['OVERRIDDEN']);
  });
});