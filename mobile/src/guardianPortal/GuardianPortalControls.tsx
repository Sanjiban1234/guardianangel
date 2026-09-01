import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

interface Props { apiBaseUrl: string; authToken: string; groupCode: string; }
export default function GuardianPortalControls({ apiBaseUrl, authToken, groupCode }: Props) {
  const [loading, setLoading] = useState(false); const [active, setActive] = useState(false); const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let cancelled=false; fetch(`${apiBaseUrl}/api/guardian-portal/shares/current?group_code=${encodeURIComponent(groupCode)}`, { headers:{ Authorization:`Bearer ${authToken}` } }).then(r=>r.ok?r.json():null).then(body=>{ if (!cancelled) setActive(Boolean(body?.active)); }).catch(()=>undefined); return ()=>{cancelled=true;}; }, [apiBaseUrl, authToken, groupCode]);
  const create = async () => { setLoading(true); try { const r=await fetch(`${apiBaseUrl}/api/guardian-portal/shares`, { method:'POST', headers:{ Authorization:`Bearer ${authToken}`, 'Content-Type':'application/json' }, body:JSON.stringify({ group_code:groupCode }) }); const body=await r.json(); if (!r.ok || typeof body?.url !== 'string') throw new Error(); setUrl(body.url); setActive(true); await Share.share({ title:'Guardian Portal', message:`Follow my live ride in Guardian Portal: ${body.url}` }); } catch { Alert.alert('Guardian Portal', 'Could not start live sharing. Please try again.'); } finally { setLoading(false); } };
  const revoke = async () => { setLoading(true); try { const r=await fetch(`${apiBaseUrl}/api/guardian-portal/shares/current?group_code=${encodeURIComponent(groupCode)}`, { method:'DELETE', headers:{ Authorization:`Bearer ${authToken}` } }); if (!r.ok) throw new Error(); setActive(false); setUrl(null); } catch { Alert.alert('Guardian Portal', 'Could not stop live sharing. Please try again.'); } finally { setLoading(false); } };
  return <View style={{ position:'absolute', right:12, bottom:86, alignItems:'flex-end', gap:6 }}>
    {active && url ? <Pressable accessibilityRole="button" onPress={() => Share.share({ title:'Guardian Portal', message:`Follow my live ride in Guardian Portal: ${url}` })} style={{ backgroundColor:'#142318', padding:10, borderRadius:10 }}><Text style={{ color:'#F0FDF4', fontWeight:'800' }}>Share live link</Text></Pressable> : null}
    <Pressable accessibilityRole="button" disabled={loading} onPress={active ? revoke : create} style={{ backgroundColor:active ? '#7F1D1D' : '#166534', padding:10, borderRadius:10 }}><Text style={{ color:'#fff', fontWeight:'800' }}>{loading ? 'Please wait…' : active ? 'Stop sharing' : 'Share live ride'}</Text></Pressable>
  </View>;
}
