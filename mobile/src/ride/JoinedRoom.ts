export interface JoinedRoom {
  room_id: string;
  group_code: string;
  status: string;
  role: string;
  rideStartedAt: string | null;
  destination?: { latitude: number; longitude: number; label?: string | null };
}

export interface RoomPreviewDetails {
  roomId?: string;
  groupCode: string;
  role?: string;
  rideStartedAt?: string | null;
  destinationTitle: string;
  locationName: string;
  hostName: string;
  activeRiderCount: number;
  routeDistanceKm: number;
  destination?: JoinedRoom['destination'];
}

/** REST membership is already established; activation must not POST another join. */
export function joinedRoomPreview(room: JoinedRoom): RoomPreviewDetails {
  if (!room?.room_id || !room.group_code || room.status !== 'active') {
    throw new Error('Unable to open this ride. Please try again.');
  }
  return {
    roomId: room.room_id, groupCode: room.group_code, role: room.role,
    rideStartedAt: room.rideStartedAt, destination: room.destination,
    destinationTitle: room.destination?.label || 'Group Ride',
    locationName: `Room ${room.room_id}`, hostName: 'Unknown',
    activeRiderCount: 0, routeDistanceKm: 0,
  };
}
