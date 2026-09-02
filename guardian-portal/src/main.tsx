import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

type Location = { latitude: number; longitude: number; lastUpdatedAt: number | null; connectionState: 'CONNECTED' | 'DISCONNECTED'; freshness: 'FRESH' | 'STALE' };
type State = { riderName: string; rideStatus: 'live' | 'ended'; startedAt: string; location?: Location; separationState: 'unknown' | 'separated' | 'reunited'; observerCredential?: string };

const FRESHNESS_MS = 15_000;
// The portal is served separately from the API. Strip an accidental /api suffix
// so REST and Socket.IO URLs are both composed from the backend origin.
const api = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '').replace(/\/api$/, '');
let googleLoader: Promise<void> | null = null;

function loadMaps(key: string) { if (window.google?.maps) return Promise.resolve(); if (googleLoader) return googleLoader; googleLoader = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`; s.async = true; s.onload = () => window.google?.maps ? resolve() : reject(); s.onerror = reject; document.head.append(s); }); return googleLoader; }
function Map({ location }: { location?: Location }) { const host = useRef<HTMLDivElement>(null), map = useRef<google.maps.Map | null>(null), marker = useRef<google.maps.Marker | null>(null), [status, setStatus] = useState<'LOADING' | 'READY' | 'FAILED' | 'MISSING_KEY'>(() => import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? 'LOADING' : 'MISSING_KEY'); useEffect(() => { const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY; if (key) loadMaps(key).then(() => setStatus('READY')).catch(() => setStatus('FAILED')); }, []); useEffect(() => { if (status !== 'READY' || !host.current || !location) return; const p = { lat: location.latitude, lng: location.longitude }; if (!map.current) { map.current = new google.maps.Map(host.current, { center: p, zoom: 16, zoomControl: true, streetViewControl: false, mapTypeControl: false, fullscreenControl: false, gestureHandling: 'greedy' }); marker.current = new google.maps.Marker({ map: map.current, position: p, title: 'Rider location' }); } else marker.current?.setPosition(p); }, [status, location?.latitude, location?.longitude]); if (!location) return <div className="map-placeholder">Location not available yet.</div>; if (status === 'MISSING_KEY') return <div className="map-placeholder">Map temporarily unavailable — Google Maps key is not configured.</div>; if (status === 'FAILED') return <div className="map-placeholder">Map temporarily unavailable.</div>; return <div className="map-wrap"><div ref={host} className="google-map" />{status === 'LOADING' && <div className="map-loading">Loading map…</div>}</div>; }

function App() {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState<string | null>(null), [events, setEvents] = useState<string[]>([]), token = useMemo(() => window.location.hash.slice(1), []);
  useEffect(() => { if (!token) { setError('This Guardian Portal link is unavailable.'); return; } let off = false; fetch(`${api}/api/guardian-portal/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).then(r => r.ok ? r.json() : Promise.reject()).then((d: State) => { if (!off) { setState(d); history.replaceState(null, '', window.location.pathname); } }).catch(() => !off && setError('This Guardian Portal link is unavailable.')); return () => { off = true; }; }, [token]);
  useEffect(() => {
    if (!state?.observerCredential || state.rideStatus !== 'live') return;
    // Keep polling available as a fallback when a proxy cannot establish a
    // WebSocket immediately; Socket.IO upgrades to WebSocket when possible.
    const socket = io(`${api}/guardian-portal`, { autoConnect: false, auth: { credential: state.observerCredential }, reconnection: true });
    socket.on('portal:location', (p: { latitude: number; longitude: number; lastUpdatedAt: number }) => setState(current => current ? { ...current, location: { ...p, connectionState: 'CONNECTED', freshness: 'FRESH' } } : current));
    socket.on('portal:presence', (p: Pick<Location, 'lastUpdatedAt' | 'connectionState' | 'freshness'>) => setState(current => current ? { ...current, location: current.location ? { ...current.location, ...p } : current.location } : current));
    socket.on('portal:separated', () => { setState(current => current ? { ...current, separationState: 'separated' } : current); setEvents(current => ['Rider separated from the group', ...current]); });
    socket.on('portal:reunited', () => { setState(current => current ? { ...current, separationState: 'reunited' } : current); setEvents(current => ['Rider reunited with the group', ...current]); });
    socket.on('portal:sos', () => setEvents(current => ['Emergency alert: rider triggered SOS', ...current]));
    socket.on('portal:rideEnded', () => setState(current => current ? { ...current, rideStatus: 'ended', observerCredential: undefined } : current));
    socket.on('portal:revoked', () => setError('This Guardian Portal link is no longer available.'));
    socket.connect();
    return () => { socket.close(); };
  }, [state?.observerCredential, state?.rideStatus]);
  useEffect(() => { const timer = window.setInterval(() => setState(current => { const location = current?.location; if (!current || !location || location.connectionState !== 'CONNECTED' || location.lastUpdatedAt === null || Date.now() - location.lastUpdatedAt <= FRESHNESS_MS) return current; return { ...current, location: { ...location, connectionState: 'DISCONNECTED', freshness: 'STALE' } }; }), 1_000); return () => window.clearInterval(timer); }, []);
  if (error) return <main><h1>Guardian Portal</h1><p>{error}</p></main>;
  if (!state) return <main><h1>Guardian Portal</h1><p>Loading live ride…</p></main>;
  const stale = !state.location || state.location.freshness === 'STALE';
  return <main><header><strong>GUARDIAN ANGEL</strong><span>Guardian Portal</span></header><h1>{state.riderName}</h1><p className={state.rideStatus === 'ended' ? 'ended' : stale ? 'stale' : 'live'}>{state.rideStatus === 'ended' ? 'Ride ended' : stale ? 'Temporarily offline — showing last known location' : 'Live ride'}</p><p>Ride started {new Date(state.startedAt).toLocaleString()}</p><Map location={state.location} /><p>Last updated: {state.location?.lastUpdatedAt ? new Date(state.location.lastUpdatedAt).toLocaleTimeString() : '—'}</p>{state.separationState === 'separated' && <p className="sos">Separation alert active</p>}<section><h2>Safety updates</h2>{events.length ? events.map((event, index) => <p key={index}>{event}</p>) : <p>No safety alerts.</p>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
