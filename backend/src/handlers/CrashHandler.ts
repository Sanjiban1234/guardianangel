import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../middleware/AuthMiddleware';
import { EmergencyAlertService } from '../services/EmergencyAlertService';
import { CrashCandidateRepository } from '../repositories/CrashCandidateRepository';
import { RoomState } from './SessionHandler';

export class CrashHandler {
  constructor(
    private readonly io: Server,
    private readonly socket: AuthenticatedSocket,
    private readonly roomState: RoomState,
    private readonly alertService: EmergencyAlertService,
    private readonly crashRepo: CrashCandidateRepository
  ) {}

  register(): void {
    this.socket.on(
      'crash:candidate',
      (data: { timestamp: number; latitude: number; longitude: number }) =>
        this.handleCandidate(data)
    );

    this.socket.on(
      'crash:countdownExpired',
      (data: { timestamp: number; latitude: number; longitude: number }) =>
        this.handleCountdownExpired(data)
    );

    this.socket.on(
      'crash:cancelled',
      () => this.handleCancelled()
    );
  }

  private async handleCandidate(data: {
    timestamp: number;
    latitude: number;
    longitude: number;
  }): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    try {
      const roomId = await this.crashRepo.resolveRoomId(groupCode);

      const candidate = await this.crashRepo.insert(
        roomId,
        userId,
        data.timestamp,
        data.latitude,
        data.longitude
      );

      console.log(
        `CrashHandler: CANDIDATE persisted (${candidate.id}) — user "${name}" ` +
        `group "${groupCode}" @ ${data.latitude},${data.longitude}` +
        (candidate.speed != null ? ` speed=${candidate.speed}m/s` : '')
      );
    } catch (err) {
      console.error('CrashHandler.handleCandidate: persist failed:', err);
    }
  }

  private async handleCountdownExpired(data: {
    timestamp: number;
    latitude: number;
    longitude: number;
  }): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

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

      if (latest && latest.outcome === null) {
        await this.crashRepo.updateOutcome(latest.id, 'confirmed');
      }

      console.log(
        `CrashHandler: CONFIRMED — user "${name}" group "${groupCode}". Creating SOS alert.`
      );

      const alert = await this.alertService.createAlert(
        groupCode,
        userId,
        data.timestamp,
        data.latitude,
        data.longitude,
        roomId
      );

      this.io.to(`group:${groupCode}`).emit('sos:broadcast', {
        alarm_no: alert.alarm_no,
        user_id: userId,
        name,
        timestamp: data.timestamp,
        latitude: data.latitude,
        longitude: data.longitude,
      });
    } catch (err) {
      console.error('CrashHandler.handleCountdownExpired: alert insert/broadcast failed:', err);
    }
  }

  private async handleCancelled(): Promise<void> {
    const groupCode = this.roomState.currentGroupCode;
    if (!groupCode) return;

    const userId = this.socket.user!.id;
    const name = this.socket.user!.name;

    try {
      const roomId = await this.crashRepo.resolveRoomId(groupCode);

      const latest = roomId
        ? await this.crashRepo.findLatestForUserInRoom(roomId, userId)
        : await this.crashRepo.findLatestForUserByGroupCode(groupCode, userId);

      if (latest && latest.outcome === null) {
        await this.crashRepo.updateOutcome(latest.id, 'false_alarm');
      }

      console.log(
        `CrashHandler: CANCELLED — user "${name}" group "${groupCode}". Candidate marked false_alarm.`
      );
    } catch (err) {
      console.error('CrashHandler.handleCancelled: update failed:', err);
    }
  }
}
