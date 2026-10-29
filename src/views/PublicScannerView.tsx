import React, { useEffect, useRef, useState } from 'react';
import { linkFromBarcode } from '../utils/publicLink';
import { sameOriginUrl } from '../utils/safeFiles';

/**
 * Leitor de QR e códigos de barras (Code 128) pela câmara — abre a mesma página pública que o QR.
 * Também aceita leitores de código de barras USB/Bluetooth (escrevem o código no campo e premem Enter).
 * Abra: <endereço da aplicação>/?scan=1
 */
export const PublicScannerView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('A abrir a câmara…');
  const [manual, setManual] = useState('');

  const go = (text: string) => {
    const t = (text || '').trim();
    const url = /^https?:\/\//i.test(t) ? sameOriginUrl(t) : linkFromBarcode(t);
    if (url) { window.location.href = url; return true; }
    setMsg(/^https?:\/\//i.test(t) ? 'Este código aponta para outro site e foi ignorado por segurança.' : 'Código não reconhecido. Aproxime o cartão e tente de novo.');
    return false;
  };

  useEffect(() => {
    let stop = false; let stream: MediaStream | null = null; let timer: number | undefined;
    (async () => {
      const Det = (window as any).BarcodeDetector;
      if (!Det || !navigator.mediaDevices?.getUserMedia) { setMsg('Este navegador não lê códigos pela câmara. Use a câmara do telemóvel para o QR, ou escreva o código abaixo.'); return; }
      try {
        const det = new Det({ formats: ['qr_code', 'code_128'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop || !videoRef.current) return;
        videoRef.current.srcObject = stream; await videoRef.current.play();
        setMsg('Aponte ao QR ou ao código de barras do cartão.');
        timer = window.setInterval(async () => {
          try {
            const r = await det.detect(videoRef.current!);
            if (r.length && go(r[0].rawValue)) window.clearInterval(timer);
          } catch { /* frame sem código */ }
        }, 300);
      } catch { setMsg('Não foi possível usar a câmara (permita o acesso). Pode escrever o código abaixo.'); }
    })();
    return () => { stop = true; if (timer) window.clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4 gap-4 font-sans">
      <h1 className="text-lg font-bold">Leitor de cartões</h1>
      <video ref={videoRef} playsInline muted className="w-full max-w-sm rounded-xl bg-black aspect-square object-cover" />
      <p className="text-sm text-slate-300 text-center max-w-sm">{msg}</p>
      <div className="w-full max-w-sm flex gap-2">
        <input autoFocus value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go(manual)}
          placeholder="Código de barras (ex.: Pa1b2c3d4e5)" className="flex-1 px-3 py-2 rounded-lg text-slate-900 text-sm" />
        <button onClick={() => go(manual)} className="px-4 py-2 rounded-lg bg-emerald-600 font-bold text-sm">Abrir</button>
      </div>
    </div>
  );
};
