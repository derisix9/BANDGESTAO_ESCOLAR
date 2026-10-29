/** Página de verificação da ligação Supabase: abra http://localhost:3000/supabase-check.html */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { signIn, verifyMfa, enrollTotp, signOutUser, loadProfile, mfaSatisfied } from './services/authSupabase';
import { supabase } from './services/supabase';
import type { User } from './types';

type Check = { name: string; ok: boolean; detail?: string };

function Page() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(''); const [user, setUser] = useState<User | null>(null);
  const [mfa, setMfa] = useState<{ factorId: string } | null>(null); const [code, setCode] = useState('');
  const [checks, setChecks] = useState<Check[]>([]);
  const [enroll, setEnroll] = useState<{ qr: string; secret: string; factorId: string } | null>(null);

  const refresh = async () => setUser(await loadProfile().catch(() => null));
  useEffect(() => { void refresh(); }, []);

  const doLogin = async () => {
    setMsg('');
    const r = await signIn(email, pw);
    if (!r.success) return setMsg(r.error || 'Falhou');
    if (r.needsMfa && r.factorId) return setMfa({ factorId: r.factorId });
    await refresh();
  };
  const doMfa = async () => {
    if (!mfa) return; const r = await verifyMfa(mfa.factorId, code);
    if (!r.success) return setMsg(r.error || 'Falhou'); setMfa(null); await refresh();
  };

  const runChecks = async () => {
    if (!user) return; const out: Check[] = [];
    const add = (name: string, ok: boolean, detail?: string) => out.push({ name, ok, detail });
    add('Perfil carregado (' + user.role + ' @ ' + user.institutionId + ')', !!user.institutionId);
    const acl = await supabase.from('collection_acl').select('collection', { count: 'exact', head: true });
    add('Lê a tabela de permissões (66 colecções)', acl.count === 66, 'count=' + acl.count);
    const other = await supabase.from('records').select('id', { count: 'exact', head: true }).neq('institution_id', user.institutionId!);
    add('NÃO vê dados de outras escolas', (other.count ?? 0) === 0, 'count=' + other.count);
    const id = 'teste_' + Date.now();
    const ins = await supabase.from('records').insert({ institution_id: user.institutionId, collection: 'departments', id, data: { id, name: 'Teste de ligação' } });
    add('Admin grava um registo de teste', !ins.error, ins.error?.message);
    const rd = await supabase.from('records').select('id').eq('collection', 'departments').eq('id', id).maybeSingle();
    add('Lê o registo gravado', rd.data?.id === id);
    const hack = await supabase.from('profiles').insert({ id: crypto.randomUUID(), institution_id: user.institutionId, role: 'admin', name: 'x', email: 'x@x.x' });
    add('Cliente NÃO consegue criar perfis admin (buraco fechado)', !!hack.error, hack.error?.message);
    const pay = await supabase.from('records').insert({ institution_id: user.institutionId, collection: 'invoices', id: 'x' + id, data: { id: 'x' + id, status: 'pago', totalAmountKz: 1 } });
    add('NÃO consegue criar factura já "paga" à mão', !!pay.error, pay.error?.message);
    await supabase.from('records').delete().eq('collection', 'departments').eq('id', id);
    const aud = await supabase.from('audit_log').select('seq', { count: 'exact', head: true });
    add('Auditoria registou as acções', (aud.count ?? 0) > 0, 'linhas=' + aud.count);
    add('2FA activo nesta sessão (aal2)', await mfaSatisfied(user.role), 'recomendado para ' + user.role);
    setChecks(out);
  };

  const box: React.CSSProperties = { maxWidth: 560, margin: '40px auto', background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 12px #0001' };
  const inp: React.CSSProperties = { width: '100%', padding: 10, margin: '6px 0 12px', border: '1px solid #ccd', borderRadius: 8, boxSizing: 'border-box' };
  const btn: React.CSSProperties = { padding: '10px 16px', background: '#0B1F3A', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', marginRight: 8 };

  return (<div style={box}>
    <h2 style={{ marginTop: 0, color: '#0B1F3A' }}>BandMed — Verificação Supabase</h2>
    {!user && !mfa && (<>
      <label>E-mail</label><input style={inp} value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
      <label>Palavra-passe</label><input style={inp} type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" />
      <button style={btn} onClick={doLogin}>Entrar</button>
    </>)}
    {mfa && (<><p>Introduza o código de 6 dígitos da sua app autenticadora.</p>
      <input style={inp} value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
      <button style={btn} onClick={doMfa}>Verificar</button></>)}
    {user && (<>
      <p>Sessão: <b>{user.name}</b> ({user.role}) — escola <code>{user.institutionId}</code></p>
      <button style={btn} onClick={runChecks}>Correr verificações</button>
      <button style={btn} onClick={async () => setEnroll(await enrollTotp())}>Activar 2FA</button>
      <button style={{ ...btn, background: '#7A0C0C' }} onClick={async () => { await signOutUser(); setUser(null); setChecks([]); }}>Sair</button>
      {enroll && (<div style={{ marginTop: 16 }}>
        <p>Leia o QR com Google Authenticator / Authy e guarde o segredo: <code>{enroll.secret}</code></p>
        <img src={enroll.qr} alt="QR 2FA" width={180} />
        <p>Depois de ler, saia e entre de novo: o código passará a ser pedido.</p></div>)}
      <ul style={{ paddingLeft: 18 }}>{checks.map((c, i) =>
        <li key={i} style={{ color: c.ok ? '#0a7a2f' : '#b00020', margin: '6px 0' }}>{c.ok ? '✔' : '✘'} {c.name}{c.detail && !c.ok ? ' — ' + c.detail : ''}</li>)}</ul>
    </>)}
    {msg && <p style={{ color: '#b00020' }}>{msg}</p>}
  </div>);
}
createRoot(document.getElementById('root')!).render(<Page />);
