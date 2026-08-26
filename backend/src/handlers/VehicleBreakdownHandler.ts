import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { VehicleBreakdownService } from '../services/VehicleBreakdownService';
import { MedicalInfoService } from '../services/MedicalInfoService';
import { PresenceService } from '../services/PresenceService';
import { logger } from '../utils/logger';
import { RoomState } from './SessionHandler';
import type {
  VehicleBreakdownPayload,
  VehicleBreakdownReportedPayload,
  VehicleBreakdownResolvedPayload,
} from '@guardian-angel/contracts/websocket-events';

export class VehicleBreakdownHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly breakdownService: VehicleBreakdownService,
    private readonly medicalService?: MedicalInfoService,
    private readonly presenceService?: PresenceService,
  ) {}

  register(): void {
    this.socket.on(
      'vehicle:breakdown',
      (data?: VehicleBreakdownPayload) => this.handleBreakdown(data)
    );

    this.socket.on(
      'vehicle:breakdownResolved',
      () => this.handleBreakdownResolved()
    );
  }

  private async handleBreakdown(data?: VehicleBreakdownPayload): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    const userId = this.socket.user?.id;
    const name = this.socket.user?.name;
    if (!userId || !name) return;

    try {
      const record = await this.breakdownService.reportBreakdown(
        groupCode,
        userId,
        name,
        data?.reason,
        data?.note
      );

      logger.info('vehicle breakdown reported', { event: 'vehicle:breakdown' });
      const riderIdentity = this.presenceService
        ? (await this.presenceService.getRiderPresence(groupCode)).find((rider) => rider.user_id === userId)
        : undefined;

      const broadcastPayload: VehicleBreakdownReportedPayload = {
        breakdown_id: record.id,
        user_id: userId,
        name,
        vehicle_model: riderIdentity?.vehicle_model,
        plate_number: riderIdentity?.plate_number,
        reason: record.reason,
        note: record.note,
        latitude: record.latitude,
        longitude: record.longitude,
        reported_at: record.reported_at,
      };

      this.io.to(`group:${groupCode}`).emit('vehicle:breakdownReported', broadcastPayload);
    } catch (err) {
      logger.error('vehicle breakdown report failed', err);
      this.socket.emit('error', {
        message: err instanceof Error ? err.message : 'Failed to report breakdown',
      });
    }
  }

  private async handleBreakdownResolved(): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    const userId = this.socket.user?.id;
    const name = this.socket.user?.name;
    if (!userId || !name) return;

    try {
      const res = await this.breakdownService.resolveBreakdown(groupCode, userId);

      logger.info('vehicle breakdown resolved', { event: 'vehicle:breakdownResolved' });

      const broadcastPayload: VehicleBreakdownResolvedPayload = {
        breakdown_id: res.breakdown_id,
        user_id: userId,
        name,
        resolved_at: res.resolved_at,
      };

      this.io.to(`group:${groupCode}`).emit('vehicle:breakdownResolved', broadcastPayload);
    } catch (err) {
      logger.error('vehicle breakdown resolution failed', err);
      this.socket.emit('error', {
        message: err instanceof Error ? err.message : 'Failed to resolve breakdown',
      });
    }
  }
}
