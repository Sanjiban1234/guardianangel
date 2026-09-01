import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { EmergencyAlertService } from '../services/EmergencyAlertService';
import { CrashCandidateRepository } from '../repositories/CrashCandidateRepository';
import { MedicalInfoService } from '../services/MedicalInfoService';
import { PresenceService } from '../services/PresenceService';
import { RoomState } from './SessionHandler';
import { logger } from '../utils/logger';
import { EmergencyDisclosureAuditService } from '../services/EmergencyDisclosureAuditService';
import { GuardianPortalShareService } from '../services/GuardianPortalShareService';
import { PortalBroadcaster } from '../sockets/GuardianPortalSocketController';

export class CrashHandler {
  private static readonly userCrashTimestamps: Map<string, number[]> = new Map();

  static resetRateLimits(): void {
    CrashHandler.userCrashTimestamps.clear();
  }

  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly alertService: EmergencyAlertService,
    private readonly crashRepo: CrashCandidateRepository,
    private readonly medicalService?: MedicalInfoService,
    private readonly presenceService?: PresenceService,
    private readonly disclosureAudit?: EmergencyDisclosureAuditService, private readonly portalShares?: GuardianPortalShareService, private readonly portal?: PortalBroadcaster,
  ) {}

  register(): void {
    this.socket.on(
      'crash:candidate',
      (data: { timestamp: number; latitude: number; longitude: number; user_id?: unknown }) =>
        this.handleCandidate(data)
    );

    this.socket.on(
      'crash:countdownExpired',
      (data: { timestamp: number; latitude: number; longitude: number; user_id?: unknown }) =>
        this.handleCountdownExpired(data)
    );

    this.socket.on(
      'crash:cancelled',
      () => this.handleCancelled()
    );
  }

  private isRateLimited(userId: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const maxEvents = 3;

    const timestamps = CrashHandler.userCrashTimestamps.get(userId) || [];
    const recent = timestamps.filter((ts) => now - ts < windowMs);

    if (recent.length >= maxEvents) {
      this.socket.emit('error', {
        message: 'Rate limit exceeded: too many crash events',
      });
      return true;
    }

    recent.push(now);
    CrashHandler.userCrashTimestamps.set(userId, recent);
    return false;
  }

  private async handleCandidate(data: {
    timestamp: number;
    latitude: number;
    longitude: number;
    user_id?: unknown;
  }): Promise<void> {
    if (!this.isValidEvent(data)) return;
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    // Never trust a client-supplied user_id; the JWT-authenticated socket owns this event.
    const { id: userId, name } = this.socket.user!;

    if (this.isRateLimited(userId)) return;

    try {
      const roomId = await this.crashRepo.resolveRoomId(groupCode);

      const candidate = await this.crashRepo.insert(
        roomId,
        userId,
        data.timestamp,
        data.latitude,
        data.longitude
      );

      logger.info('crash candidate persisted', { event: 'crash:candidate' });
    } catch (err) {
      logger.error('crash candidate persistence failed', err);
    }
  }

  private async handleCountdownExpired(data: {
    timestamp: number;
    latitude: number;
    longitude: number;
    user_id?: unknown;
  }): Promise<void> {
    if (!this.isValidEvent(data)) return;
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    // Never trust a client-supplied user_id; the JWT-authenticated socket owns this event.
    const { id: userId, name } = this.socket.user!;

    try {
      // Single resolution point — used for both outcome update and alert creation.
      // If room has been ended mid-countdown, this returns null but we still
      // proceed: the SOS must fire and the outcome must be recorded.
      const roomId = await this.crashRepo.resolveRoomId(groupCode);

      // Mark outcome regardless of room resolution. If roomId is null (race:
      // room ended mid-countdown), fall back to finding the candidate by user_id
      // alone within this group's candidates. The candidate was inserted when
      // the room WAS active, so it has a room_id even if resolution now fails.
      const latest = roomId
        ? await this.crashRepo.findLatestForUserInRoom(roomId, userId)
        : await this.crashRepo.findLatestForUserByGroupCode(groupCode, userId);

      if (!latest || latest.outcome !== null || Math.abs(data.timestamp - latest.device_timestamp_ms) > 90_000) {
        this.socket.emit('error', { message: 'A recent crash candidate is required before confirming SOS' });
        return;
      }
      // Telemetry is optional during reconnects, but when a recent trusted
      // reading exists its location must be physically plausible.  100m GPS
      // allowance + 60m/s maximum travel is deliberately tolerant of drift,
      // sparse five-second samples, and ordinary motorbike movement.
      if (roomId) {
        const telemetry = await this.crashRepo.getLatestTelemetry(roomId, userId);
        if (telemetry && Math.abs(data.timestamp - telemetry.timestamp) <= 5 * 60_000) {
          const distance = await this.crashRepo.distanceFromLatestTelemetry(roomId, userId, data.latitude, data.longitude);
          const allowedDistance = 100 + 60 * (Math.abs(data.timestamp - telemetry.timestamp) / 1000);
          if (distance !== null && distance > allowedDistance) {
            this.socket.emit('error', { message: 'Crash location is inconsistent with recent telemetry' });
            return;
          }
        }
      }
      if (latest && latest.outcome === null) {
        await this.crashRepo.updateOutcome(latest.id, 'confirmed');
      }

      logger.info('crash confirmed', { event: 'sos' });

      const alert = await this.alertService.createAlert(
        groupCode,
        userId,
        data.timestamp,
        data.latitude,
        data.longitude,
        roomId
      );

      const medicalInfo = this.medicalService
        ? await this.medicalService.getMedicalInfoSnapshot(userId)
        : undefined;
      const categories = [
        medicalInfo?.blood_group || medicalInfo?.allergies ? 'medical_basic' : null,
        medicalInfo?.emergency_contact_name || medicalInfo?.emergency_contact_phone ? 'emergency_contact' : null,
      ].filter((value): value is string => value !== null);
      if (categories.length && this.disclosureAudit) await this.disclosureAudit.record(userId, roomId, alert.alarm_no, categories);
      const riderIdentity = this.presenceService
        ? (await this.presenceService.getRiderPresence(groupCode)).find((rider) => rider.user_id === userId)
        : undefined;

      this.io.to(`group:${groupCode}`).emit('sos:broadcast', {
        alarm_no: alert.alarm_no,
        user_id: userId,
        name,
        vehicle_model: riderIdentity?.vehicle_model,
        plate_number: riderIdentity?.plate_number,
        timestamp: data.timestamp,
        latitude: data.latitude,
        longitude: data.longitude,
        medical_info: medicalInfo,
      });
      this.portal?.sos((await this.portalShares?.activeSharesForRoom(groupCode) || []).filter((share) => share.owner_user_id === userId).map((share) => share.id), { timestamp: data.timestamp, latitude: data.latitude, longitude: data.longitude });
    } catch (err) {
      logger.error('SOS creation failed', err);
    }
  }

  private isValidEvent(data: unknown): data is { timestamp: number; latitude: number; longitude: number } {
    if (!data || typeof data !== 'object') { this.socket.emit('error', { message: 'Invalid crash payload' }); return false; }
    const { timestamp, latitude, longitude } = data as Record<string, unknown>;
    const now = Date.now();
    const valid = [timestamp, latitude, longitude].every((v) => typeof v === 'number' && Number.isFinite(v))
      && (latitude as number) >= -90 && (latitude as number) <= 90
      && (longitude as number) >= -180 && (longitude as number) <= 180
      && (timestamp as number) >= now - 10 * 60_000 && (timestamp as number) <= now + 2 * 60_000;
    if (!valid) this.socket.emit('error', { message: 'Invalid or stale crash payload' });
    return valid;
  }

  private async handleCancelled(): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    // Cancellation applies only to the JWT-authenticated socket user.
    const { id: userId, name } = this.socket.user!;

    try {
      const roomId = await this.crashRepo.resolveRoomId(groupCode);

      const latest = roomId
        ? await this.crashRepo.findLatestForUserInRoom(roomId, userId)
        : await this.crashRepo.findLatestForUserByGroupCode(groupCode, userId);

      if (latest && latest.outcome === null) {
        await this.crashRepo.updateOutcome(latest.id, 'false_alarm');
      }

      logger.info('crash candidate cancelled', { event: 'crash:cancelled' });
    } catch (err) {
      logger.error('crash cancellation failed', err);
    }
  }
}
