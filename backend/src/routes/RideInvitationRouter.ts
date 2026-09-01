import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthMiddleware, AuthenticatedRequest } from '../middleware/AuthMiddleware';
import { RideInvitationService } from '../services/RideInvitationService';
import { AppError } from '../utils/AppError';
const limiter=rateLimit({windowMs:60_000,max:20,standardHeaders:true,legacyHeaders:false,message:{error:'Too many invitation actions, please try again shortly'}});
export class RideInvitationRouter { readonly router=Router(); constructor(private readonly invitations: RideInvitationService) { const guarded=(h:(r:AuthenticatedRequest,s:Response)=>void)=>(r:any,s:Response)=>h(r as AuthenticatedRequest,s);
  this.router.get('/ride-invitations',AuthMiddleware.authenticateJWT,guarded((r,s)=>this.run(r,s,()=>this.invitations.list(r.user!.id))));
  this.router.post('/rooms/:roomId/invitations',AuthMiddleware.authenticateJWT,limiter,guarded((r,s)=>this.run(r,s,()=>this.invitations.invite(r.user!.id,r.params.roomId,r.body?.invitee_user_id),201)));
  this.router.post('/ride-invitations/:id/accept',AuthMiddleware.authenticateJWT,limiter,guarded((r,s)=>this.run(r,s,()=>this.invitations.accept(r.user!.id,r.params.id))));
  this.router.post('/ride-invitations/:id/decline',AuthMiddleware.authenticateJWT,limiter,guarded((r,s)=>this.run(r,s,()=>this.invitations.decline(r.user!.id,r.params.id)))); }
 private async run(r:AuthenticatedRequest,s:Response,action:()=>Promise<any>,code=200) { if(!r.user?.id){s.status(401).json({error:'Unauthorized'});return;} try{const value=await action();s.status(code).json(value===undefined?{ok:true}:value);}catch(e:any){if(e instanceof AppError){s.status(400).json({error:e.message,code:e.code});return;}s.status(500).json({error:'Unable to complete invitation action'});}} }
