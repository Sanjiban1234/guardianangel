import { Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';
import { query } from '../db';
import crypto from 'crypto';

const router = Router();

const joinRoomLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many join attempts. Try again in 15 minutes.' }
});

// Utility function to generate a human-readable 16-character room join token
function generateRoomToken(): string {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

// GET /api/health - Connectivity watcher check endpoint
router.get('/health', (req, res) => {
  return res.status(200).json({ status: 'healthy', timestamp: Date.now() });
});

// POST /api/rooms - Create a new Ride Room
router.post('/rooms', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
  }

  try {
    const roomToken = generateRoomToken();

    // Create the room
    const roomResult = await query(
      'INSERT INTO ride_rooms (room_token, creator_id, status) VALUES ($1, $2, \'active\') RETURNING id, room_token, creator_id',
      [roomToken, userId]
    );

    const room = roomResult.rows[0];

    // Auto-join the creator to the room
    await query(
      'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [room.id, userId]
    );

    return res.status(201).json({
      room_id: room.id,
      room_token: room.room_token,
      creator_id: room.creator_id
    });
  } catch (error) {
    console.error('Error creating ride room:', error);
    return res.status(500).json({ error: 'Internal server error while creating ride room' });
  }
});

// POST /api/rooms/join - Join a Ride Room via token
router.post('/rooms/join', authenticateJWT, joinRoomLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { room_token } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
  }

  if (!room_token) {
    return res.status(400).json({ error: 'Room token is required' });
  }

  if (typeof room_token !== 'string' || room_token.length > 32) {
    return res.status(400).json({ error: 'Invalid room token format' });
  }

  try {
    // Find room details by token
    const roomResult = await query(
      'SELECT id, status FROM ride_rooms WHERE room_token = $1',
      [room_token.toUpperCase()]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ride room not found' });
    }

    const room = roomResult.rows[0];

    if (room.status !== 'active') {
      return res.status(400).json({ error: 'This ride room has already ended' });
    }

    // Add user as a member
    await query(
      'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [room.id, userId]
    );

    return res.status(200).json({
      message: 'Successfully joined room',
      room_id: room.id
    });
  } catch (error) {
    console.error('Error joining ride room:', error);
    return res.status(500).json({ error: 'Internal server error while joining ride room' });
  }
});

// GET /api/rooms/:roomId/history - Retrieve room telemetry history
router.get('/rooms/:roomId/history', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { roomId } = req.params;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user credentials' });
  }

  try {
    // 1. Authorization check: Make sure user is a member of the targeted room
    const memberCheck = await query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this ride room' });
    }

    // 2. Query historical telemetry readings
    const historyResult = await query(
      `SELECT t.user_id, u.username, t.device_timestamp, t.latitude, t.longitude, t.accuracy, t.speed 
       FROM telemetry_readings t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.room_id = $1 
       ORDER BY t.device_timestamp ASC`,
      [roomId]
    );

    return res.status(200).json(historyResult.rows);
  } catch (error) {
    console.error('Error retrieving room history:', error);
    return res.status(500).json({ error: 'Internal server error while fetching telemetry history' });
  }
});

export default router;
