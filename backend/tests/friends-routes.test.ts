import express from 'express';
import request from 'supertest';
import { FriendRouter } from '../src/routes/FriendRouter';
import { RideInvitationRouter } from '../src/routes/RideInvitationRouter';
import { createAuthenticatedTestSession, installTestSessionValidator } from './helpers/auth';

describe('Friends HTTP and notification bindings', () => {
  const sent: Array<{room:string;event:string;payload:any}> = [];
  const io: any = { to: jest.fn((room:string) => ({ emit: (event:string,payload:any) => sent.push({room,event,payload}) })) };
  const friendService: any = { setUsername: jest.fn(), search: jest.fn(), request: jest.fn(), respond: jest.fn(), publicUser: jest.fn(), list: jest.fn(), requests: jest.fn(), cancel: jest.fn(), remove: jest.fn(), block: jest.fn(), unblock: jest.fn() };
  const invitationService: any = { list: jest.fn(), invite: jest.fn(), accept: jest.fn(), decline: jest.fn() };
  let app: express.Express; let a: string; let b: string; let c: string;
  beforeEach(() => { jest.clearAllMocks(); sent.length=0; installTestSessionValidator(); a=createAuthenticatedTestSession({id:'a',name:'A',role:'rider'}).token;b=createAuthenticatedTestSession({id:'b',name:'B',role:'rider'}).token;c=createAuthenticatedTestSession({id:'c',name:'C',role:'rider'}).token;app=express();app.use(express.json());app.use('/api',new FriendRouter(friendService,io).router);app.use('/api',new RideInvitationRouter(invitationService,friendService,io).router); });
  const auth=(token:string)=>({Authorization:`Bearer ${token}`});
  it('requires authentication and returns sanitized username search results', async()=>{friendService.search.mockResolvedValue([{userId:'b',displayName:'B',username:'brider'}]);expect((await request(app).get('/api/users/search?q=bri')).status).toBe(401);const r=await request(app).get('/api/users/search?q=bri').set(auth(a));expect(r.status).toBe(200);expect(r.body).toEqual([{userId:'b',displayName:'B',username:'brider'}]);expect(JSON.stringify(r.body)).not.toMatch(/email|phone|plate|location/i);});
});
