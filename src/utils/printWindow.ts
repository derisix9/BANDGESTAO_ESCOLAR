/**
 * Imprime uma janela criada com window.open('') + document.write, SEM script dentro do documento.
 * Motivo: a CSP (vercel.json) proíbe scripts e atributos on* inline, e uma janela about:blank herda essa política;
 * o antigo `<script>window.print()</script>` deixaria de funcionar. Aqui quem imprime é a aplicação.
 * Espera pelas imagens (logótipos, assinaturas) para não imprimir uma folha sem elas.
 */
export function printWhenReady(w: Window | null, opts: { delayMs?: number; maxWaitMs?: number } = {}): void {
  if (!w) return;
  const delay = opts.delayMs ?? 250;
  const maxWait = opts.maxWaitMs ?? 4000;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    try { w.focus(); w.print(); } catch { /* janela fechada pelo utilizador */ }
  };
  let pending: HTMLImageElement[] = [];
  try { pending = Array.from(w.document.images).filter((i) => !i.complete); } catch { /* janela já fechada */ }
  if (pending.length === 0) { setTimeout(go, delay); return; }
  let left = pending.length;
  const one = () => { left -= 1; if (left <= 0) setTimeout(go, delay); };
  pending.forEach((img) => { img.addEventListener('load', one); img.addEventListener('error', one); });
  setTimeout(go, maxWait);
}
