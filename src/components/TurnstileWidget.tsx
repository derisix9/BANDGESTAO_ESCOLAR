import React, { useEffect, useRef } from 'react';
import { Notice } from './Notice';

/** Captcha Cloudflare Turnstile. Site key em VITE_TURNSTILE_SITE_KEY. Muda a prop `resetKey` para o refazer. */
export const TURNSTILE_SITE_KEY = ((import.meta as any).env?.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';

/** Chaves de teste da Cloudflare (1x…, 2x…, 3x…): passam sempre. Em produção são um captcha de enfeite. */
const IS_TEST_KEY = /^[123]x0{10,}/.test(TURNSTILE_SITE_KEY);
const BLOCK_TEST_KEY = IS_TEST_KEY && !!(import.meta as any).env?.PROD;

declare global { interface Window { turnstile?: any } }

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error('captcha')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

interface Props { onToken: (token: string | null) => void; resetKey?: number }

export const TurnstileWidget: React.FC<Props> = ({ onToken, resetKey = 0 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || BLOCK_TEST_KEY) return;
    let id: string | undefined;
    let cancelled = false;
    onToken(null);
    loadScript().then(() => {
      if (cancelled || !ref.current) return;
      id = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        language: 'pt-br',
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null)
      });
    }).catch(() => setFailed(true));
    return () => { cancelled = true; try { if (id) window.turnstile?.remove(id); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) {
    return <Notice tone="error">Captcha não configurado: defina VITE_TURNSTILE_SITE_KEY no .env.</Notice>;
  }
  if (BLOCK_TEST_KEY) {
    return <Notice tone="error">O captcha está com a chave de TESTE da Cloudflare. Em VITE_TURNSTILE_SITE_KEY use a chave real do seu widget Turnstile (a mesma cujo secret está em Authentication → Attack Protection no Supabase).</Notice>;
  }
  if (failed) {
    return <Notice tone="error">Não foi possível carregar o captcha. Verifique a ligação e recarregue a página.</Notice>;
  }
  return <div ref={ref} className="flex justify-center mt-6 mb-4 min-h-[65px]" />;
};
