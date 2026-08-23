import { RideTrackingController } from '../src/tracking/RideTrackingController';

describe('RideTrackingController', () => {
  it('starts once for active ride and ignores reconnect duplicates', async () => {
    const service = { start: jest.fn(async () => {}), stop: jest.fn(async () => {}) };
    const controller = new RideTrackingController(service);

    await controller.ensureStarted();
    await controller.ensureStarted();

    expect(service.start).toHaveBeenCalledTimes(1);
    expect(controller.isActive()).toBe(true);
  });

  it('stops once when a member leaves or ride ends', async () => {
    const service = { start: jest.fn(async () => {}), stop: jest.fn(async () => {}) };
    const controller = new RideTrackingController(service);

    await controller.ensureStarted();
    await controller.ensureStopped();
    await controller.ensureStopped();

    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(controller.isActive()).toBe(false);
  });

  it('does not mark tracking active when native startup fails', async () => {
    const service = {
      start: jest.fn(async () => { throw new Error('permission denied'); }),
      stop: jest.fn(async () => {}),
    };
    const controller = new RideTrackingController(service);

    await expect(controller.ensureStarted()).rejects.toThrow('permission denied');
    expect(controller.isActive()).toBe(false);
  });
});
