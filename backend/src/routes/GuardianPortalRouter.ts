import { Router, Response } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { AuthenticatedRequest, AuthMiddleware } from '../middleware/AuthMiddleware';
import { GuardianPortalShareError, GuardianPortalShareService } from '../services/GuardianPortalShareService';
import { PortalBroadcaster } from '../sockets/GuardianPortalSocketController';

const createStore = new MemoryStore(); const bootstrapStore = new MemoryStore();
const createLimiter = rateLimit({ windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false, store: createStore });
const bootstrapLimiter = rateLimit({ windowMs: 60_000, max: 12, standardHeaders: true, legacyHeaders: false, store: bootstrapStore, message: { error: 'Link unavailable' } });
const noStore = (res: Response) => res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'Pragma': 'no-cache' });

export class GuardianPortalRouter {
  readonly router = Router();
  constructor(private readonly shares: GuardianPortalShareService, private readonly portal?: PortalBroadcaster) {
    this.router.post('/guardian-portal/shares', createLimiter, AuthMiddleware.authenticateJWT, (req, res) => void this.create(req as AuthenticatedRequest, res));
    this.router.get('/guardian-portal/shares/current', AuthMiddleware.authenticateJWT, (req, res) => void this.current(req as AuthenticatedRequest, res));
    this.router.delete('/guardian-portal/shares/current', AuthMiddleware.authenticateJWT, (req, res) => void this.revoke(req as AuthenticatedRequest, res));
    this.router.post('/guardian-portal/bootstrap', bootstrapLimiter, (req, res) => void this.bootstrap(req, res));
  }
  private groupCode(value: unknown): string | null { return typeof value === 'string' && /^[A-Za-z0-9]{4,32}$/.test(value) ? value : null; }
  private async create(req: AuthenticatedRequest, res: Response) { const code=this.groupCode(req.body?.group_code); if (!req.user?.id || !code) { res.status(400).json({ error:'Invalid request' }); return; } try { noStore(res).status(201).json(await this.shares.create(req.user.id, code)); } catch (e) { res.status(e instanceof GuardianPortalShareError ? 409 : 500).json({ error:'Live sharing is unavailable for this ride' }); } }
  private async current(req: AuthenticatedRequest, res: Response) { const code=this.groupCode(req.query.group_code); if (!req.user?.id || !code) { res.status(400).json({ error:'Invalid request' }); return; } noStore(res).json(await this.shares.current(req.user.id, code)); }
  private async revoke(req: AuthenticatedRequest, res: Response) { const code=this.groupCode(req.query.group_code); if (!req.user?.id || !code) { res.status(400).json({ error:'Invalid request' }); return; } const ids=await this.shares.revoke(req.user.id, code); this.portal?.revoked(ids); noStore(res).json({ revoked: ids.length > 0 }); }
  private async bootstrap(req: any, res: Response) { const token=req.body?.token; if (typeof token !== 'string' || token.length < 32 || token.length > 256) { noStore(res).status(404).json({ error:'Link unavailable' }); return; } try { noStore(res).json(await this.shares.bootstrap(token)); } catch { noStore(res).status(404).json({ error:'Link unavailable' }); } }
}
