/**
 * Histórico Académico em PDF (texto vectorial, pesquisável). Uma secção por ano lectivo/classe,
 * com notas por trimestre, média final da disciplina, exame (classes de exame) e situação,
 * mais um quadro-resumo de todo o percurso.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import type { HistoryEntry, StudioData } from './data';
import { LEVEL_LABEL, levelOfGrade } from './data';
import { dataPorExtenso, upper } from './format';

export interface HistoricoOptions {
  data: StudioData;
  brasao?: string;
  logo?: string;
  docNumber?: string;
  verifyCode?: string;
  /** Link público gravado no QR: ao ler, o telemóvel descarrega este histórico em PDF. */
  verifyUrl?: string;
  /** Mostrar as notas de cada trimestre (MT1/MT2/MT3) além da média final. */
  trimestres?: boolean;
  accent?: [number, number, number];
}

const EXAM_CLASSES = [6, 9, 12, 13];
const n = (v: unknown) => (typeof v === 'number' && v > 0 ? String(Math.round(v)) : '');

function rowsOf(h: HistoryEntry, withTrim: boolean) {
  const exam = h.classNum != null && EXAM_CLASSES.includes(h.classNum);
  return h.records.map((r) => {
    const final = exam && typeof r.mf === 'number' && r.mf > 0 ? r.mf : r.mfd;
    const base = [r.subjectName];
    if (withTrim) base.push(n(r.mt1), n(r.mt2), n(r.mt3));
    base.push(n(r.mfd));
    if (exam) base.push(n(r.nee));
    base.push(n(final), r.situation || '');
    return base;
  });
}

/** Desenha o histórico de um aluno a partir da página actual (o lote chama uma vez por aluno). */
async function renderHistorico(doc: jsPDF, o: HistoricoOptions): Promise<void> {
  const { data } = o;
  const accent = o.accent || [11, 31, 58];
  const W = 210, M = 14;
  let y = 12;

  if (o.brasao) { try { doc.addImage(o.brasao, 'PNG', W / 2 - 8, y, 16, 17); } catch { /* imagem inválida: segue sem brasão */ } }
  y += 20;
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(0);
  doc.text('REPÚBLICA DE ANGOLA', W / 2, y, { align: 'center' }); y += 4.6;
  doc.text('MINISTÉRIO DA EDUCAÇÃO', W / 2, y, { align: 'center' }); y += 4.6;
  doc.setTextColor(accent[0], accent[1], accent[2]).text(upper(data.school.name), W / 2, y, { align: 'center', maxWidth: W - 2 * M }); y += 7;
  doc.setTextColor(0).setFontSize(15).text('HISTÓRICO ACADÉMICO', W / 2, y, { align: 'center' }); y += 3;
  doc.setDrawColor(accent[0], accent[1], accent[2]).setLineWidth(0.6).line(M, y, W - M, y); y += 6;

  // Identificação
  const p = data.person;
  const ident: Array<[string, string]> = [
    ['Nome', p.name], ['Nº de Processo', p.procNumber],
    ['Filiação', [p.father, p.mother].filter(Boolean).join(' e ') || '—'], ['B.I. Nº', p.bi || '—'],
    ['Data de nascimento', p.birthDate || '—'], ['Naturalidade', [p.naturalidade, p.municipio, p.provincia].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / ') || '—']
  ];
  autoTable(doc, {
    startY: y, theme: 'plain', margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30, textColor: [90, 90, 90] }, 1: { cellWidth: 62 }, 2: { fontStyle: 'bold', cellWidth: 30, textColor: [90, 90, 90] }, 3: { cellWidth: 60 } },
    body: [[ident[0][0], ident[0][1], ident[1][0], ident[1][1]], [ident[2][0], ident[2][1], ident[3][0], ident[3][1]], [ident[4][0], ident[4][1], ident[5][0], ident[5][1]]]
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  const withTrim = o.trimestres !== false;
  const entries = data.history.filter((h) => h.records.length);
  if (!entries.length) {
    doc.setFont('helvetica', 'italic').setFontSize(10).setTextColor(120).text('Sem notas registadas para este aluno.', M, y + 6);
    y += 14;
  }
  for (const h of entries) {
    const exam = h.classNum != null && EXAM_CLASSES.includes(h.classNum);
    const head = ['Disciplina', ...(withTrim ? ['MT1', 'MT2', 'MT3'] : []), 'MFD', ...(exam ? ['Exame'] : []), 'Nota final', 'Situação'];
    const colStyles: Record<number, any> = { 0: { cellWidth: 'auto', halign: 'left' } };
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: [[{ content: `${h.grade || '—'}  ·  Ano lectivo ${h.year}${h.className ? '  ·  ' + h.className : ''}`, colSpan: head.length, styles: { halign: 'left', fillColor: accent, textColor: 255, fontSize: 9 } }], head],
      body: rowsOf(h, withTrim),
      foot: [[{ content: `Média final: ${h.finalAverage ?? '—'}   ·   Resultado: ${h.result}`, colSpan: head.length, styles: { halign: 'right', fontStyle: 'bold', fillColor: [235, 238, 243], textColor: 20 } }]],
      styles: { fontSize: 8, cellPadding: 1.1, lineColor: [150, 150, 150], lineWidth: 0.15, textColor: 20 },
      headStyles: { fillColor: [235, 238, 243], textColor: 20, fontStyle: 'bold', halign: 'center' },
      columnStyles: Object.assign(colStyles, ...head.slice(1).map((_, i) => ({ [i + 1]: { halign: i === head.length - 2 ? 'left' : 'center', cellWidth: i === head.length - 2 ? 28 : 'auto' } }))),
      didParseCell: (d) => { if (d.section === 'head' && d.row.index === 0) d.cell.styles.halign = 'left'; },
      showFoot: 'lastPage', pageBreak: 'auto', rowPageBreak: 'avoid'
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    if (y > 262) { doc.addPage(); y = 14; }
  }

  // Quadro-resumo
  if (entries.length) {
    if (y > 235) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(accent[0], accent[1], accent[2]).text('QUADRO-RESUMO DO PERCURSO ESCOLAR', M, y); y += 2;
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.3, lineColor: [150, 150, 150], lineWidth: 0.15 },
      head: [['Ano lectivo', 'Classe', 'Nível', 'Média final', 'Resultado']], headStyles: { fillColor: accent, textColor: 255 },
      body: entries.map((h) => [h.year, h.grade, LEVEL_LABEL[levelOfGrade(h.grade)], h.finalAverage ?? '—', h.result])
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Rodapé: data, assinaturas e QR
  if (y > 240) { doc.addPage(); y = 14; }
  const where = data.school.city ? `${data.school.city}, ` : '';
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(0).text(`${where}${dataPorExtenso(new Date(), false)}.`, W / 2, y, { align: 'center' }); y += 16;
  doc.setLineWidth(0.3).setDrawColor(0).line(M + 6, y, M + 70, y).line(W - M - 70, y, W - M - 6, y);
  doc.setFontSize(8.5).text('O Chefe da Secretaria', M + 38, y + 4, { align: 'center' }).text('O Director', W - M - 38, y + 4, { align: 'center' });
  doc.setFont('helvetica', 'bold').text(data.school.secretariaName || '', M + 38, y + 8, { align: 'center' }).text(data.school.directorName || '', W - M - 38, y + 8, { align: 'center' });
  if (o.docNumber || o.verifyUrl) {
    // O QR abre o link público que descarrega este histórico em PDF (ver PublicRecordView).
    const qr = await QRCode.toDataURL(o.verifyUrl || `HIST|${o.docNumber}|${o.verifyCode || ''}|${data.school.name}`, { margin: 0, width: o.verifyUrl ? 320 : 220, errorCorrectionLevel: 'M' });
    doc.addImage(qr, 'PNG', W / 2 - 9, y - 6, 18, 18);
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(90).text(`${o.docNumber || ''}${o.verifyCode ? ' · ' + o.verifyCode : ''}`, W / 2, y + 15, { align: 'center' });
  }
}

export async function buildHistoricoPdf(o: HistoricoOptions): Promise<Uint8Array> {
  return buildHistoricoPdfBatch([o]);
}

/** Históricos de vários alunos (turma inteira) num único PDF: cada aluno começa em página nova. */
export async function buildHistoricoPdfBatch(items: HistoricoOptions[]): Promise<Uint8Array> {
  if (!items.length) throw new Error('Sem históricos para exportar.');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 14;
  const starts: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) doc.addPage();
    starts.push(doc.getNumberOfPages());
    await renderHistorico(doc, items[i]);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    let owner = 0;
    for (let k = 0; k < starts.length; k++) if (starts[k] <= i) owner = k;
    const it = items[owner];
    doc.setPage(i).setFont('helvetica', 'normal').setFontSize(7).setTextColor(120);
    doc.text(`${it.data.school.name} · Histórico Académico de ${it.data.person.name}`, M, 290).text(`Página ${i} de ${pages}`, 210 - M, 290, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
