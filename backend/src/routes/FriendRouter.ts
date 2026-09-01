import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { FriendService } from '../services/FriendService';
import { AppError } from '../utils/AppError';

const searchLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many searches, please try again shortly' } });
const mutationLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many friend actions, please try again shortly' } });
export class FriendRouter {
  readonly router = Router();
  constructor(private readonly friends: FriendService) {
    const guarded = (handler: (req: AuthenticatedRequest, res: Response) => void) => (req: any, res: Response) => handler(req as AuthenticatedRequest, res);
    this.router.put('/users/username', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.setUsername(req.user!.id, req.body?.username).then(username => ({ username })))));
    this.router.get('/users/search', AuthMiddleware.authenticateJWT, searchLimiter, guarded((req,res) => this.run(req,res, () => this.friends.search(req.user!.id, String(req.query.q || '')))));
    this.router.get('/friends', AuthMiddleware.authenticateJWT, guarded((req,res) => this.run(req,res, () => this.friends.list(req.user!.id))));
    this.router.get('/friends/requests/:direction', AuthMiddleware.authenticateJWT, guarded((req,res) => this.run(req,res, () => ['incoming','outgoing'].includes(req.params.direction) ? this.friends.requests(req.user!.id, req.params.direction as 'incoming'|'outgoing') : Promise.reject(new AppError('Not found','NOT_FOUND')))));
    this.router.post('/friends/requests', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.request(req.user!.id, req.body?.receiver_user_id), 201)));
    this.router.post('/friends/requests/:id/accept', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.respond(req.user!.id, req.params.id, true), 200)));
    this.router.post('/friends/requests/:id/decline', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.respond(req.user!.id, req.params.id, false), 200)));
    this.router.delete('/friends/requests/:id', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.cancel(req.user!.id, req.params.id), 200)));
    this.router.delete('/friends/:userId', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.remove(req.user!.id, req.params.userId), 204)));
    this.router.post('/users/:userId/block', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.block(req.user!.id, req.params.userId), 204)));
    this.router.delete('/users/:userId/block', AuthMiddleware.authenticateJWT, mutationLimiter, guarded((req,res) => this.run(req,res, () => this.friends.unblock(req.user!.id, req.params.userId), 204)));
  }
  private async run(req: AuthenticatedRequest, res: Response, action: () => Promise<any>, success = 200) { if (!req.user?.id) { res.status(401).json({error:'Unauthorized'}); return; } try { const value=await action(); success === 204 ? res.status(204).send() : res.status(success).json(value === undefined ? { ok: true } : value); } catch (e:any) { if (e instanceof AppError) { res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({error:e.message, code:e.code}); return; } res.status(500).json({error:'Unable to complete friend action'}); } }
}
