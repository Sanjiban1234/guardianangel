import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { QueryRunner } from '../db/QueryRunner';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET } from '../config';
import { AppError } from '../utils/AppError';

export interface RegisterResult {
  id: string;
  name: string;
  email: string;
  vehicle_model?: string;
  plate_number?: string;
  vehicle_color?: string;
}

export interface LoginResult {
  token: string;
  user: { id: string; name: string; email: string; profile_complete: boolean; vehicle_model?: string; plate_number?: string; vehicle_color?: string };
}

export interface VehicleProfile {
  vehicle_model?: string;
  plate_number?: string;
  vehicle_color?: string;
}

export class UserService {
  constructor(private readonly db: QueryRunner) {}

  async register(
    name: string,
    email: string,
    password: string,
    phone: string,
    vehicleModel?: string,
    plateNumber?: string,
    vehicleColor?: string,
  ): Promise<RegisterResult> {
    // Check if email is already registered
    const existingEmail = await this.db.run(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existingEmail.rows.length > 0) {
      throw new AppError('Email is already registered', 'EMAIL_TAKEN');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await this.db.run(
      `INSERT INTO users (name, email, password_hash, phone, vehicle_model, plate_number, vehicle_color, profile_complete)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id, name, email, vehicle_model, plate_number, vehicle_color`,
      [name, email, passwordHash, phone, vehicleModel, plateNumber, vehicleColor]
    );

    return result.rows[0] as RegisterResult;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.db.run(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid email or password', 'AUTH_FAILED');
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      throw new AppError('Invalid email or password', 'AUTH_FAILED');
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role === 'admin' ? 'admin' : 'rider' },
      JWT_SECRET,
      { expiresIn: '24h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile_complete: user.profile_complete !== false,
        vehicle_model: user.vehicle_model || undefined,
        plate_number: user.plate_number || undefined,
        vehicle_color: user.vehicle_color || undefined,
      },
    };
  }

  async updateGeoHash(userId: string, geohash: string): Promise<void> {
    await this.db.run(
      'UPDATE users SET geohash = $1 WHERE id = $2',
      [geohash, userId]
    );
  }

  async getVehicleProfile(userId: string): Promise<VehicleProfile | null> {
    const result = await this.db.run(
      'SELECT vehicle_model, plate_number, vehicle_color FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0] ? result.rows[0] as VehicleProfile : null;
  }

  async updateVehicleProfile(userId: string, vehicleModel: string, plateNumber: string, vehicleColor: string): Promise<VehicleProfile> {
    const normalizedModel = vehicleModel.trim();
    const normalizedPlate = plateNumber.trim().replace(/\s+/g, ' ');
    const normalizedColor = vehicleColor.trim();
    if (!normalizedModel || normalizedModel.length > 100) {
      throw new AppError('Vehicle model must be between 1 and 100 characters', 'INVALID_PROFILE');
    }
    if (!normalizedPlate || normalizedPlate.length > 50) {
      throw new AppError('Plate number must be between 1 and 50 characters', 'INVALID_PROFILE');
    }
    if (!normalizedColor || normalizedColor.length > 50) {
      throw new AppError('Vehicle color must be between 1 and 50 characters', 'INVALID_PROFILE');
    }
    const result = await this.db.run(
      `UPDATE users SET vehicle_model = $1, plate_number = $2, vehicle_color = $3 WHERE id = $4
       RETURNING vehicle_model, plate_number, vehicle_color`,
      [normalizedModel, normalizedPlate, normalizedColor, userId],
    );
    if (!result.rows.length) throw new AppError('User not found', 'USER_NOT_FOUND');
    return result.rows[0] as VehicleProfile;
  }
}
