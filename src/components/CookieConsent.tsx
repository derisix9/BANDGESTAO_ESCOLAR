import React, { useEffect, useState } from 'react';

/**
 * Aviso de cookies (primeira utilização). O utilizador escolhe: Aceitar tudo, Rejeitar não essenciais ou Personalizar.
 * A escolha fica guardada (12 meses) e pode ser reaberta com `openCookieSettings()` (ex.: link no rodapé).
 * Cookies/armazenamento ESSENCIAIS (sessão, segurança, captcha) funcionam sempre; os restantes só com consentimento.
 * Código que dependa de consentimento: `getCookieConsent()?.preferences` / `?.analytics`.
 */
const KEY = 'bandmed_cookie_consent_v1';
const EVENT = 'bandmed:open-cookie-settings';
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export interface CookieConsentValue { necessary: true; preferences: boolean; analytics: boolean; decidedAt: number }

export function getCookieConsent(): CookieConsentValue | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as CookieConsentValue;
    return Date.now() - v.decidedAt > MAX_AGE_MS ? null : v;
  } catch { return null; }
}
export function openCookieSettings() { window.dispatchEvent(new Event(EVENT)); }

export const CookieConsent: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [custom, setCustom] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const cur = getCookieConsent();
    if (!cur) setVisible(true);
    else { setPrefs(cur.preferences); setAnalytics(cur.analytics); }
    const open = () => { const c = getCookieConsent(); setPrefs(!!c?.preferences); setAnalytics(!!c?.analytics); setCustom(true); setVisible(true); };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  const save = (preferences: boolean, an: boolean) => {
    const v: CookieConsentValue = { necessary: true, preferences, analytics: an, decidedAt: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sem armazenamento: o aviso volta na próxima visita */ }
    window.dispatchEvent(new CustomEvent('bandmed:cookie-consent', { detail: v }));
    setVisible(false); setCustom(false);
  };

  if (!visible) return null;
  const btn = 'px-4 py-2 rounded-lg text-xs font-bold transition-colors';
  return (
    <div role="dialog" aria-live="polite" aria-label="Aviso de cookies"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100000, padding: 12, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      <div className="mx-auto max-w-3xl bg-white text-slate-800 border border-slate-200 rounded-2xl shadow-2xl p-4 sm:p-5">
        <p className="text-sm font-bold text-[#0b1f3a]">Este site utiliza cookies</p>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          Usamos cookies essenciais para manter a sua sessão e a segurança da conta. Com a sua autorização, usamos também cookies de
          preferências (tema, idioma) e de estatística para melhorar o BandMed. Pode mudar de ideias a qualquer momento.
        </p>
        {custom && (
          <div className="mt-3 space-y-2 text-xs">
            <label className="flex items-start gap-2 opacity-70"><input type="checkbox" checked disabled className="mt-0.5" />
              <span><b>Essenciais</b> — sessão, segurança e captcha. Sempre ativos.</span></label>
            <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" checked={prefs} onChange={(e) => setPrefs(e.target.checked)} className="mt-0.5" />
              <span><b>Preferências</b> — lembrar tema, idioma e definições de ecrã.</span></label>
            <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="mt-0.5" />
              <span><b>Estatística</b> — medir a utilização de forma agregada.</span></label>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          {custom ? (
            <button type="button" onClick={() => save(prefs, analytics)} className={`${btn} bg-[#0b1f3a] text-white hover:bg-[#7a0c0c]`}>Guardar escolha</button>
          ) : (
            <button type="button" onClick={() => setCustom(true)} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>Personalizar</button>
          )}
          <button type="button" onClick={() => save(false, false)} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>Rejeitar não essenciais</button>
          <button type="button" onClick={() => save(true, true)} className={`${btn} bg-[#0b1f3a] text-white hover:bg-[#7a0c0c]`}>Aceitar todos</button>
        </div>
      </div>
    </div>
  );
};
