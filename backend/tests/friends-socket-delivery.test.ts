import { AddressInfo } from 'net';
import { io as ClientIO, Socket } from 'socket.io-client';
import { server, io } from '../src/index';
import { createAuthenticatedTestSession, installTestSessionValidator, resetTestSessions } from './helpers/auth';

jest.mock('../src/db', () => ({ query: jest.fn(), pool: { connect: jest.fn() }, initDb: jest.fn().mockResolvedValue(true) }));

const privateKeys = /email|phone|medical|emergency|plate|location|token|jwt|session|guardian/i;
describe('Friends Socket.IO recipient delivery and isolation', () => {
  let port = 0; let clients: Socket[] = [];
  const users = [{id:'friend-a',name:'A'},{id:'friend-b',name:'B'},{id:'friend-c',name:'C'}];
  beforeAll((done) => { installTestSessionValidator(); server.listen(0, () => { port=(server.address() as AddressInfo).port; done(); }); });
  afterAll((done) => { io.close(); server.close(done); });
  beforeEach(() => resetTestSessions());
  afterEach(() => { clients.forEach(c=>c.disconnect()); clients=[]; });
  const connect = (user:{id:string;name:string}) => new Promise<Socket>((resolve,reject) => { const token=createAuthenticatedTestSession({...user,role:'rider'}).token; const socket=ClientIO(`http://localhost:${port}`,{auth:{token, userId:'friend-b'},query:{userId:'friend-b'},transports:['websocket']}); clients.push(socket); socket.once('connect',()=>resolve(socket)); socket.once('connect_error',reject); });
  const noEvent = (socket:Socket,event:string) => new Promise<void>((resolve,reject) => { const timer=setTimeout(resolve,120); socket.once(event,()=>{clearTimeout(timer);reject(new Error(`${event} leaked`));}); });
  it('delivers friend and ride social events only to their authenticated user rooms with sanitized payloads', async () => {
    const [a,b,c]=await Promise.all(users.map(connect));
    const received=new Promise<any>(resolve=>b.once('friend:request',resolve)); const quietA=noEvent(a,'friend:request'); const quietC=noEvent(c,'friend:request');
    io.to('user:friend-b').emit('friend:request',{userId:'friend-a',displayName:'A',username:'arider',requestId:'r1'});
    const payload=await received; await Promise.all([quietA,quietC]); expect(Object.keys(payload).join(',')).not.toMatch(privateKeys);
    const accepted=new Promise<any>(resolve=>a.once('ride:invitationAccepted',resolve)); const quietRide=noEvent(c,'ride:invitationAccepted'); io.to('user:friend-a').emit('ride:invitationAccepted',{invitationId:'i1',invitee:{userId:'friend-b',displayName:'B',username:'brider'}}); expect((await accepted).invitee.username).toBe('brider'); await quietRide;
  },10000);
});
