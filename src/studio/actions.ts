/**
 * Acções do Estúdio de Documentos: transformam o que está no ecrã em ficheiros e ligam cada
 * emissão ao registo numerado do sistema (Processos Académicos → Documentos).
 */
import type { AcademicDocType } from '../utils/academicProcesses';
import type { CardModel } from './cards';
import type { FlowDoc, FlowModel } from './flow';
import type { Scene } from './scene';
import type { StudioData } from './data';
import { buildDocx, buildDocxBatch, dataUrlToImg } from './exportDocx';
import type { ImgData } from './exportDocx';
import { buildCardsPptx } from './exportPptx';
import { buildHistoricoPdf, buildHistoricoPdfBatch } from './exportPdf';
import { downloadBytes, fitImage, gradientImage, MIME } from './images';
import type { ImageSlots } from './images';
import { esc, slug } from './format';

/** Tipo de documento do registo oficial correspondente a cada modelo. */
export const docTypeOfFlow = (m: FlowModel): AcademicDocType =>
  m.kind === 'certificado' ? 'certificado' : m.withGrades ? 'declaracao_com_notas' : 'declaracao_sem_notas';

export const docTypeOfCard = (m: CardModel): AcademicDocType => (m.kind === 'diploma' ? 'diploma' : 'cartao_estudante');

/** Valor gravado no QR: conferido contra o registo da escola (número + código de verificação). */
export const verifyValueFor = (number: string, code: string, school: string) => `DOC|${number}|${code}|${school}`;

const dims = (src: string): Promise<{ w: number; h: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });

/** Converte as imagens (data URL) para o formato que o DOCX precisa, com as proporções reais. */
export async function imagesForDocx(images: ImageSlots): Promise<Record<string, ImgData | undefined>> {
  const out: Record<string, ImgData | undefined> = {};
  for (const [slot, src] of Object.entries(images)) {
    if (!src) continue;
    const d = await dims(src);
    out[slot] = dataUrlToImg(src, d.w, d.h);
  }
  return out;
}

export interface ExportFlowArgs {
  doc: FlowDoc;
  images: ImageSlots;
  overrides: Record<string, string>;
  number?: string;
  /** Brasão para a marca de água (só usada quando o modelo a pede). */
  brasao?: string;
}

/** Certificado ou declaração → Word (.docx) editável, com moldura, papel e tabelas reais. */
export async function exportFlowDocx(a: ExportFlowArgs): Promise<string> {
  let watermark: ImgData | undefined;
  if (a.doc.page.watermark && a.brasao) {
    const faded = await fitImage(a.brasao, 110, 110, { fit: 'contain', opacity: 0.08 });
    watermark = dataUrlToImg(faded, 1, 1);
  }
  const bytes = await buildDocx(a.doc, { overrides: a.overrides, images: await imagesForDocx(a.images), watermark });
  const name = `${slug(a.doc.title)}${a.number ? '-' + a.number : ''}.docx`;
  downloadBytes(bytes, name, MIME.docx);
  return name;
}

export interface ExportFlowBatchArgs extends Omit<ExportFlowArgs, 'doc'> {
  docs: FlowDoc[];
}

/** Turma inteira → um único Word (.docx), um certificado/declaração por página. */
export async function exportFlowDocxBatch(a: ExportFlowBatchArgs): Promise<string> {
  let watermark: ImgData | undefined;
  if (a.docs[0]?.page.watermark && a.brasao) {
    const faded = await fitImage(a.brasao, 110, 110, { fit: 'contain', opacity: 0.08 });
    watermark = dataUrlToImg(faded, 1, 1);
  }
  const bytes = await buildDocxBatch(a.docs, { overrides: a.overrides, images: await imagesForDocx(a.images), watermark });
  const name = `${slug(a.docs[0]?.title || 'documentos')}${a.number ? '-' + a.number : ''}.docx`;
  downloadBytes(bytes, name, MIME.docx);
  return name;
}

export interface ExportCardsArgs {
  model: CardModel;
  items: Array<{ front: Scene; back?: Scene }>;
  sides: 'frente' | 'verso' | 'ambos';
  images: ImageSlots;
  photos: Array<string | undefined>;
  overrides: Record<string, string>;
  docIndex?: number;
  number?: string;
}

/** Cartões, crachás e diplomas → PowerPoint (.pptx) com formas e caixas de texto nativas. */
export async function exportCardsPptxFile(a: ExportCardsArgs): Promise<string> {
  const bytes = await buildCardsPptx({
    items: a.items, sides: a.sides, images: a.images, photos: a.photos, overrides: a.overrides,
    docIndex: a.docIndex ?? 0, title: a.model.name, fit: fitImage, gradient: gradientImage
  });
  const name = `${slug(a.model.name)}${a.number ? '-' + a.number : ''}.pptx`;
  downloadBytes(bytes, name, MIME.pptx);
  return name;
}

export interface ExportHistoricoArgs {
  data: StudioData;
  images: ImageSlots;
  number?: string;
  code?: string;
  verifyUrl?: string;
  trimestres?: boolean;
}

/** Histórico académico → PDF paginado com quadro-resumo e QR de validação. */
export async function exportHistorico(a: ExportHistoricoArgs): Promise<string> {
  const bytes = await buildHistoricoPdf({
    data: a.data, brasao: a.images.brasao, logo: a.images.logo,
    docNumber: a.number, verifyCode: a.code, verifyUrl: a.verifyUrl, trimestres: a.trimestres
  });
  const name = `historico-${slug(a.data.person.name)}${a.number ? '-' + a.number : ''}.pdf`;
  downloadBytes(bytes, name, MIME.pdf);
  return name;
}

export interface ExportHistoricoBatchArgs {
  items: Array<{ data: StudioData; number?: string; code?: string; verifyUrl?: string }>;
  images: ImageSlots;
  trimestres?: boolean;
  number?: string;
}

/** Turma inteira → um único PDF, com o histórico de cada aluno a começar em página nova. */
export async function exportHistoricoBatch(a: ExportHistoricoBatchArgs): Promise<string> {
  const bytes = await buildHistoricoPdfBatch(a.items.map((it) => ({
    data: it.data, brasao: a.images.brasao, logo: a.images.logo, docNumber: it.number, verifyCode: it.code, verifyUrl: it.verifyUrl, trimestres: a.trimestres
  })));
  const name = `historicos${a.number ? '-' + a.number : ''}.pdf`;
  downloadBytes(bytes, name, MIME.pdf);
  return name;
}

/**
 * Imprime só o que está na pré-visualização (cartões, diplomas ou folhas A4). Abre uma janela
 * limpa com o HTML já renderizado, sem os controlos do sistema à volta.
 */
export function printPreview(root: HTMLElement | null, opts: { landscape?: boolean; title?: string; sheets?: boolean } = {}) {
  if (!root) return;
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) return;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-no-print]').forEach((n) => n.remove());
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  w.document.write(`<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${esc(opts.title || 'Estúdio de Documentos')}</title>
<style>
  @page { size: A4 ${opts.landscape ? 'landscape' : 'portrait'}; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  .sheet { display: flex; flex-wrap: wrap; gap: 6mm; padding: 8mm; justify-content: center; align-content: flex-start; }
  .studio-scene, .studio-paper { box-shadow: none !important; }
  .studio-paper { break-after: page; margin: 0 auto; }
  .sheet.sheets { display: block; padding: 0; }
</style></head><body><div class="sheet${opts.sheets ? ' sheets' : ''}">${clone.innerHTML}</div></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 450);
}
