/**
 * Lista de presença de uma reunião de pais/encarregados, pronta a imprimir:
 * um quadro com os convocados e uma coluna em branco para cada encarregado assinar.
 * Usa um iframe oculto (não depende de pop-ups, que os navegadores costumam bloquear).
 */
import type { ParentTeacherMeeting } from '../types';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const fmtDatePt = (iso?: string) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

export interface MeetingSheetOptions {
  schoolName?: string;
  /** Logótipo da escola (URL ou data URL); aparece no topo da folha. */
  logoUrl?: string;
  typeLabel?: string;
}

/** Nome para a assinatura: primeiro e último nome, com inicial maiúscula («MARIA ANA SILVA» → «Maria Silva»). */
export function signatureName(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const pick = parts.length > 2 ? [parts[0], parts[parts.length - 1]] : parts;
  return pick.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/** Situação de um convocado numa reunião já realizada. */
export function participantSituation(status: string): { label: string; present: boolean; tone: 'ok' | 'bad' | 'none' } {
  if (status === 'compareceu') return { label: 'Esteve presente', present: true, tone: 'ok' };
  if (status === 'faltou') return { label: 'Faltou', present: false, tone: 'bad' };
  return { label: 'Sem registo de presença', present: false, tone: 'none' };
}

/** HTML completo (A4) da lista de presença. Função pura, testável. */
export function buildMeetingAttendanceHtml(m: ParentTeacherMeeting, opts: MeetingSheetOptions = {}): string {
  // Reunião já realizada: coluna «Situação» + assinatura manuscrita digital automática (só de quem esteve presente).
  // Reunião agendada (ou outra): folha em branco para assinar à mão, como sempre.
  const done = m.status === 'realizada';
  const cols = done ? 6 : 5;
  const rows = m.participants
    .map((p, i) => {
      const sit = participantSituation(p.status);
      const sig = done
        ? (sit.present
            ? `<span class="hand">${esc(signatureName(p.guardianName || p.studentName))}</span><span class="stamp">Assinado digitalmente</span>`
            : '<span class="none">—</span>')
        : '';
      return `<tr>
        <td class="n">${i + 1}</td>
        <td>${esc(p.guardianName || '—')}</td>
        <td>${esc(p.studentName)}</td>
        <td class="tel">${esc(p.guardianPhone || '')}</td>
        ${done ? `<td class="sit ${sit.tone}">${esc(sit.label)}</td>` : ''}
        <td class="sig">${sig}</td>
      </tr>`;
    })
    .join('');
  const empty = m.participants.length === 0 ? `<tr><td colspan="${cols}" class="empty">Sem encarregados convocados.</td></tr>` : '';
  const presentes = m.participants.filter((p) => p.status === 'compareceu').length;
  const faltaram = m.participants.filter((p) => p.status === 'faltou').length;
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Lista de presença — ${esc(m.code)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 12px; }
  h1 { font-size: 15px; margin: 0; text-transform: uppercase; text-align: center; }
  h2 { font-size: 13px; margin: 4px 0 12px; text-align: center; color: #0b1f3a; text-transform: uppercase; letter-spacing: .04em; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 12px; }
  .meta b { color: #475569; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #334155; padding: 7px 6px; text-align: left; }
  th { background: #0b1f3a; color: #fff; font-size: 10px; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  td.n { width: 28px; text-align: center; }
  td.tel { width: 90px; }
  td.sig { width: 190px; height: 34px; }
  td.sit { width: 120px; font-weight: 700; font-size: 11px; }
  td.sit.ok { color: #047857; } td.sit.bad { color: #b91c1c; } td.sit.none { color: #64748b; font-weight: 400; }
  .hand { display: block; font-family: 'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', 'Snell Roundhand', cursive; font-size: 16px; line-height: 1.2; color: #1e3a8a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .logo { display: block; margin: 0 auto 6px; max-height: 64px; max-width: 160px; object-fit: contain; }
  .stamp { display: block; font-size: 7px; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin-top: 1px; }
  .none { color: #94a3b8; }
  td.empty { text-align: center; color: #64748b; padding: 18px; }
  tr { page-break-inside: avoid; }
  .note { margin: 8px 0 0; font-size: 10px; color: #64748b; }
  .foot { margin-top: 28px; display: flex; justify-content: space-between; gap: 40px; }
  .foot div { flex: 1; text-align: center; border-top: 1px solid #334155; padding-top: 4px; font-size: 11px; }
</style></head><body>
${opts.logoUrl ? `<img class="logo" src="${esc(opts.logoUrl)}" alt="">` : ''}
<h1>${esc(opts.schoolName || 'Instituição de Ensino')}</h1>
<h2>Lista de presença — reunião de pais e encarregados de educação</h2>
<div class="meta">
  <div><b>Reunião:</b> ${esc(m.title)} (${esc(m.code)})</div>
  <div><b>Tipo:</b> ${esc(opts.typeLabel || m.type)}</div>
  <div><b>Data:</b> ${esc(fmtDatePt(m.date))}</div>
  <div><b>Hora:</b> ${esc(m.startTime)} – ${esc(m.endTime)}</div>
  <div><b>Professor:</b> ${esc(m.teacherName)}</div>
  <div><b>Local:</b> ${esc(m.location || '—')}</div>
  ${m.className ? `<div><b>Turma:</b> ${esc(m.className)}</div>` : ''}
  <div><b>Convocados:</b> ${m.participants.length}</div>
  ${done ? `<div><b>Estado:</b> Realizada</div><div><b>Presentes / Faltas:</b> ${presentes} / ${faltaram}</div>` : ''}
</div>
<table>
  <thead><tr><th>N.º</th><th>Encarregado de Educação</th><th>Educando</th><th>Contacto</th>${done ? '<th>Situação</th>' : ''}<th>Assinatura</th></tr></thead>
  <tbody>${rows}${empty}</tbody>
</table>
${done ? '<p class="note">Assinaturas geradas automaticamente pelo sistema a partir do registo de presença; só constam para quem esteve presente.</p>' : ''}
<div class="foot"><div>O(A) Professor(a)</div><div>A Direcção / Secretaria</div></div>
</body></html>`;
}

/** Abre a impressão da lista de presença (iframe oculto, removido no fim). */
export function printMeetingAttendance(m: ParentTeacherMeeting, opts: MeetingSheetOptions = {}): void {
  if (typeof document === 'undefined') return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(buildMeetingAttendanceHtml(m, opts)); doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  // Espera pelo logótipo (até 2,5 s) para não imprimir a folha sem ele.
  const img = doc.querySelector('img.logo') as HTMLImageElement | null;
  const go = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } finally { cleanup(); }
  };
  if (img && !img.complete) {
    let done = false;
    const once = () => { if (!done) { done = true; setTimeout(go, 100); } };
    img.addEventListener('load', once); img.addEventListener('error', once);
    setTimeout(once, 2500);
  } else {
    setTimeout(go, 250);
  }
}
