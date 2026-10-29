/**
 * Reimpressão de um documento já emitido no Estúdio de Documentos.
 * Lê a receita guardada no registo (Documentos Académicos), volta a desenhar o documento
 * exactamente como foi emitido (mesmo número, QR, textos editados, fundo e arredondamento)
 * e abre a janela de impressão. Para o Histórico (PDF) abre o PDF pronto a imprimir.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { SchoolDatabase } from '../types';
import type { AcademicDocument } from '../types/processos';
import { assembleStudio } from './assemble';
import { printPreview } from './actions';
import { buildHistoricoPdf } from './exportPdf';
import { urlToDataUrl } from './images';
import { stateFromSnapshot } from './snapshot';
import { buildStudioData, levelOfGrade } from './data';
import { flowModelsFor, suggestedModelId } from './session';
import type { StudioTab } from './session';
import { CardSheets } from './ui/CardSheets';
import { FlowPaper } from './ui/FlowPaper';

const BRASAO_URL = '/pauta/insignia_angola.png';

/** Todos os documentos podem ser reimpressos: os antigos (sem receita) são redesenhados com o modelo por omissão do Estúdio. */
export const canReprint = (_doc: AcademicDocument) => true;

const TAB_OF: Record<string, StudioTab> = {
  certificado: 'certificado', declaracao_sem_notas: 'declaracao', declaracao_com_notas: 'declaracao',
  diploma: 'diploma', cartao_estudante: 'estudante', cracha_funcionario: 'funcionario', historico_academico: 'historico'
};

/** Receita por omissão para documentos emitidos antes de o Estúdio guardar o desenho. */
function defaultSnapshot(doc: AcademicDocument, db: SchoolDatabase): Record<string, any> {
  const tab = TAB_OF[doc.type] || 'estudante';
  const student = (db.students || []).find((s) => String(s.id) === String(doc.studentId));
  const data = student ? buildStudioData(db, student, doc.academicYear || db.settings?.currentAcademicYear || '') : null;
  let modelId = suggestedModelId(tab, data);
  if (tab === 'declaracao') {
    const want = doc.type === 'declaracao_com_notas';
    const list = flowModelsFor(tab, data ? levelOfGrade(data.enrollment.grade) : undefined);
    modelId = (list.find((m) => !!m.withGrades === want) || list[0])?.id || modelId;
  }
  return {
    v: 1, tab, modelId, studentId: tab === 'funcionario' ? '' : String(doc.studentId),
    staffIds: tab === 'funcionario' ? [String(doc.studentId)] : [], year: doc.academicYear || '', purpose: doc.purpose || '', images: {}
  };
}

export async function reprintIssuedDocument(doc: AcademicDocument, db: SchoolDatabase): Promise<{ ok: boolean; error?: string }> {
  const snap = doc.studioSnapshot && doc.studioSnapshot.v === 1 ? doc.studioSnapshot : defaultSnapshot(doc, db);
  const state = stateFromSnapshot(snap, { id: doc.id, number: doc.number, code: doc.verificationCode, at: doc.issuedAt });
  if (!state.images.brasao) state.images.brasao = await urlToDataUrl(BRASAO_URL);
  const logoUrl = (db.settings as any)?.logoUrl || '';
  if (!state.images.logo && logoUrl) state.images.logo = await urlToDataUrl(logoUrl);
  const v = assembleStudio(db, state);
  if (v.blockers.length) return { ok: false, error: v.blockers[0] };

  // Histórico académico: PDF paginado, aberto para imprimir.
  if (state.tab === 'historico') {
    if (!v.data) return { ok: false, error: 'Não foi possível reconstruir o histórico deste aluno.' };
    const bytes = await buildHistoricoPdf({ data: v.data, brasao: state.images.brasao, logo: state.images.logo, docNumber: doc.number, verifyCode: doc.verificationCode, trimestres: state.trimestres });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    if (!window.open(url, '_blank')) return { ok: false, error: 'O navegador bloqueou a janela. Permita pop-ups para imprimir.' };
    return { ok: true };
  }

  let node: React.ReactElement | null = null;
  let landscape = false;
  let sheets = false;
  if (v.flowDoc) {
    node = <div style={{ display: 'flex', justifyContent: 'center' }}><FlowPaper doc={v.flowDoc} images={state.images} overrides={v.overrides} watermarkSrc={state.images.brasao} zoom={1} /></div>;
  } else if (v.cardItems.length) {
    const first = v.cardItems[0].front;
    landscape = first.w >= 200 || first.h > first.w;
    sheets = true;
    node = <CardSheets items={v.cardItems} photos={v.photos} images={state.images} overrides={v.overrides} sides={state.sides} zoom={1} />;
  }
  if (!node) return { ok: false, error: 'Não há nada para imprimir neste documento.' };

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden';
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(node);
  await new Promise((r) => setTimeout(r, 900)); // deixa o QR e as imagens desenharem-se
  try {
    printPreview(host, { landscape, title: doc.number, sheets });
  } finally {
    setTimeout(() => { root.unmount(); host.remove(); }, 2000);
  }
  return { ok: true };
}
