import React, { useState } from 'react';
import { openOfflineLease, leaseMessage, type LeaseCheck, markOfflineUnlocked, DEFAULT_LEASE_DAYS } from '../services/offlineLease';
import { dbService } from '../services/db';
import { VAULT_SKIP_KEY } from '../services/localVault';
import { Notice } from './Notice';

interface Props { uid: string; name?: string; requireMfa: boolean; canSkip?: boolean; onUnlocked: () => void; onCancel: () => void }

/**
 * Desbloqueia a cópia local CIFRADA deste aparelho (cofre, ver localVault.ts) com a palavra-passe: sem internet, ou ao reabrir o
 * navegador com a sessão ainda válida. Se `requireMfa`, confirma também o lease offline.
 *
 * Sem internet, perfis com 2FA (admin, director, financeiro) têm de provar a palavra-passe para abrir a cópia local
 * e só podem fazê-lo se o último login online (com 2FA) foi há poucos dias. Ver src/services/offlineLease.ts.
 */
export const OfflineUnlockView: React.FC<Props> = ({ uid, name, requireMfa, canSkip, onUnlocked, onCancel }) => {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (requireMfa) {
        const r = await openOfflineLease(localStorage, pw, uid, { maxDays: DEFAULT_LEASE_DAYS, requireMfa });
        if (!r.ok) { setErr(leaseMessage((r as Extract<LeaseCheck, { ok: false }>).reason)); return; }
      }
      if (!(await dbService.unlockLocalVault(pw))) { setErr('Palavra-passe incorrecta.'); return; }
      if (requireMfa) markOfflineUnlocked(sessionStorage, uid);
      onUnlocked();
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9ff] p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <h2 className="font-headline text-2xl font-bold text-slate-900">{typeof navigator !== 'undefined' && navigator.onLine ? 'DESBLOQUEAR DADOS' : 'SEM INTERNET'}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {name ? `${name}, para` : 'Para'} abrir os dados guardados neste aparelho sem ligação, confirme a sua palavra-passe.
        </p>
        {err && <Notice tone="error">{err}</Notice>}
        <label className="block mt-5 text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-2" htmlFor="offpw">Palavra-passe</label>
        <input id="offpw" type="password" required autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)}
          className="w-full py-3 px-3 bg-slate-100 rounded-lg text-sm text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]" />
        <button type="submit" disabled={busy || !pw}
          className="mt-5 w-full py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] text-sm disabled:opacity-75">
          {busy ? 'A verificar…' : 'Desbloquear'}
        </button>
        {canSkip && (
          <button type="button" onClick={() => { try { sessionStorage.setItem(VAULT_SKIP_KEY, '1'); } catch { /* ignore */ } onUnlocked(); }}
            className="mt-4 block text-xs font-bold text-[#0b1f3a] hover:underline">
            Continuar sem guardar dados neste aparelho
          </button>
        )}
        <button type="button" onClick={onCancel} className="mt-4 text-xs font-bold text-[#0b1f3a] hover:underline">Voltar</button>
      </form>
    </div>
  );
};
