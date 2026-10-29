import React, { useMemo } from 'react';
import type { Block, FlowDoc, TableSpec } from '../flow';
import { borderColorOf, paperColorOf } from '../flow';
import { esc } from '../format';
import { sanitizeHtml } from '../rich';
import { FONT_STACK } from '../scene';
import type { ImageSlots } from '../images';
import { MM_PX } from './SceneView';

const PT_PX = 96 / 72;

export interface FlowPaperProps {
  doc: FlowDoc;
  images: ImageSlots;
  /** Textos alterados pelo utilizador (HTML limpo), por id do bloco. */
  overrides?: Record<string, string>;
  onEdit?: (id: string, html: string) => void;
  onPickImage?: (slot: string) => void;
  zoom?: number;
  /** Marca de água esbatida (o brasão) quando o modelo a usa. */
  watermarkSrc?: string;
}

interface Ctx extends Pick<FlowPaperProps, 'images' | 'overrides' | 'onEdit' | 'onPickImage'> { mm: number; zoom: number; font: string }

/** Texto editável: guarda HTML limpo (só negrito, itálico, sublinhado, cor, quebras). */
function Editable({ id, html, style, ctx }: { id: string; html: string; style: React.CSSProperties; ctx: Ctx }) {
  const value = ctx.overrides?.[id] ?? html;
  // O texto guardado (overrides) vem de armazenamento: nunca se injecta cru. Passa sempre pelo sanitizeHtml,
  // que reconstrói o HTML só com texto escapado e as tags b/i/u/br/span-cor permitidas.
  const safeValue = useMemo(() => sanitizeHtml(value), [value]);
  const editable = !!ctx.onEdit;
  return (
    <div
      contentEditable={editable}
      data-doc-field="true"
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={editable ? (e) => {
        const next = sanitizeHtml(e.currentTarget.innerHTML);
        if (next !== safeValue) ctx.onEdit!(id, next);
      } : undefined}
      style={{ outline: 'none', cursor: editable ? 'text' : 'default', ...style }}
      dangerouslySetInnerHTML={{ __html: safeValue }}
    />
  );
}

function ImagesRow({ b, ctx }: { b: Extract<Block, { t: 'images' }>; ctx: Ctx }) {
  const cell = (slot: string | undefined, align: 'flex-start' | 'center' | 'flex-end') => {
    const src = slot ? ctx.images[slot] : undefined;
    return (
      <div style={{ flex: 1, display: 'flex', justifyContent: align, alignItems: 'center', height: b.h * ctx.mm }}>
        {slot && (src
          ? <img src={src} alt={slot} draggable={false} onClick={ctx.onPickImage ? () => ctx.onPickImage!(slot) : undefined} style={{ maxHeight: '100%', maxWidth: 32 * ctx.mm, objectFit: 'contain', cursor: ctx.onPickImage ? 'pointer' : undefined }} />
          : ctx.onPickImage && <div data-no-print onClick={() => ctx.onPickImage!(slot)} style={{ height: '90%', aspectRatio: '1', border: '1px dashed #94a3b8', color: '#64748b', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'Arial' }}>{slot}</div>)}
      </div>
    );
  };
  return <div style={{ display: 'flex', width: '100%' }}>{cell(b.left, 'flex-start')}{cell(b.center, 'center')}{cell(b.right, 'flex-end')}</div>;
}

function GradesTable({ spec, ctx }: { spec: TableSpec; ctx: Ctx }) {
  const fs = spec.fontPt * PT_PX * ctx.zoom;
  const cell: React.CSSProperties = { border: '1px solid #000', padding: `${0.9 * ctx.mm}px ${1.4 * ctx.mm}px`, fontSize: fs, lineHeight: 1.15, verticalAlign: 'middle' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginBottom: 2 * ctx.mm, fontFamily: ctx.font }}>
      <colgroup>{spec.cols.map((c, i) => <col key={i} style={{ width: `${c.w * 100}%` }} />)}</colgroup>
      <thead>
        <tr>{spec.cols.map((c, i) => (
          <th key={i} style={{ ...cell, fontWeight: 700, textAlign: c.align === 'left' ? 'left' : 'center', background: spec.headerFill && spec.headerFill.toUpperCase() !== '#FFFFFF' ? spec.headerFill : undefined }}>{c.label}</th>
        ))}</tr>
      </thead>
      <tbody>
        {spec.rows.map((r, ri) => r.kind === 'section' ? (
          <tr key={ri}><td colSpan={spec.cols.length} style={{ ...cell, fontWeight: 700, background: spec.sectionFill }}>{r.cells[0]}</td></tr>
        ) : (
          <tr key={ri}>{r.cells.map((t, i) => (
            <td key={i} style={{ ...cell, fontWeight: r.kind === 'total' ? 700 : 400, textAlign: spec.cols[i]?.align === 'left' ? 'left' : 'center', background: r.na?.[i] && spec.naFill ? spec.naFill : undefined }}>{t}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}

function renderBlock(b: Block, i: number, ctx: Ctx) {
  const { mm, zoom } = ctx;
  switch (b.t) {
    case 'images':
      return <div key={i}><ImagesRow b={b} ctx={ctx} /></div>;
    case 'spacer':
      return <div key={i} style={{ height: b.h * mm * 0.35 }} />;
    case 'line':
      return (
        <Editable key={i} id={b.id} html={esc(b.text)} ctx={ctx} style={{
          textAlign: b.align === 'left' ? 'left' : 'center', fontSize: b.size * PT_PX * zoom, fontWeight: b.bold ? 700 : 400,
          fontFamily: b.font ? FONT_STACK[b.font] : ctx.font, marginBottom: b.after * PT_PX * zoom, lineHeight: 1.2
        }} />
      );
    case 'para':
      return (
        <Editable key={i} id={b.id} html={b.html} ctx={ctx} style={{
          textAlign: b.align, fontSize: b.size * PT_PX * zoom, marginTop: (b.before || 0) * PT_PX * zoom, marginBottom: b.after * PT_PX * zoom,
          lineHeight: 1.5, fontFamily: ctx.font
        }} />
      );
    case 'table':
      return <GradesTable key={i} spec={b.spec} ctx={ctx} />;
    case 'sign': {
      const col = (s: typeof b.left) => (
        <div style={{ flex: 1, textAlign: 'center', fontSize: 11 * PT_PX * zoom, fontFamily: ctx.font }}>
          <Editable id={s.idL} html={`<b>${esc(s.label)}</b>`} ctx={ctx} style={{ marginBottom: 14 * mm * 0.9 }} />
          <div>______________________________</div>
          <Editable id={s.idN} html={esc(s.name)} ctx={ctx} style={{}} />
        </div>
      );
      return <div key={i} style={{ display: 'flex', gap: 8 * mm, marginTop: 4 * mm }}>{col(b.left)}{col(b.right)}</div>;
    }
  }
}

/** Moldura de página (aproximação CSS das molduras do Word usadas no DOCX). */
function Frame({ doc, mm }: { doc: FlowDoc; mm: number }) {
  const color = borderColorOf(doc.page);
  const base: React.CSSProperties = { position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box' };
  const at = 8 * mm;
  switch (doc.page.border) {
    case 'duplaVermelha':
      return <div style={{ ...base, inset: at, border: `${1.8 * mm}px double ${color}` }} />;
    case 'purpura':
      return <div style={{ ...base, inset: at, border: `${1.1 * mm}px solid ${color}` }} />;
    case 'purpuraFina':
      return <div style={{ ...base, inset: at, border: `${0.9 * mm}px double ${color}` }} />;
    case 'verdeOuro':
      return <div style={{ ...base, inset: at, border: `${1.4 * mm}px double ${color}` }} />;
    case 'greca':
      return (
        <>
          <div style={{ ...base, inset: at, border: `${1.5 * mm}px solid ${color}` }} />
          <div style={{ ...base, inset: at + 2.2 * mm, border: `${0.9 * mm}px dotted ${color}` }} />
        </>
      );
    case 'fina':
      return <div style={{ ...base, inset: at, border: `${0.5 * mm}px solid ${color}` }} />;
    default:
      return null;
  }
}

/** Folha A4 com o documento. Fiel ao DOCX exportado: o utilizador edita aqui e exporta a seguir. */
export function FlowPaper({ doc, images, overrides, onEdit, onPickImage, zoom = 1, watermarkSrc }: FlowPaperProps) {
  const mm = MM_PX * zoom;
  const font = doc.page.font === 'sans' ? FONT_STACK.sans : FONT_STACK.serif;
  const ctx: Ctx = { mm, zoom, font, images, overrides, onEdit, onPickImage };
  return (
    <div
      className="studio-paper"
      style={{
        position: 'relative', width: 210 * mm, minHeight: 297 * mm, background: paperColorOf(doc.page), color: '#000',
        boxShadow: '0 8px 30px rgba(15,23,42,.25), 0 1px 3px rgba(15,23,42,.2)', overflow: 'hidden', flexShrink: 0
      }}
    >
      <Frame doc={doc} mm={mm} />
      {doc.page.watermark && watermarkSrc && (
        <img src={watermarkSrc} alt="" draggable={false} style={{ position: 'absolute', left: '50%', top: '50%', width: 110 * mm, height: 110 * mm, transform: 'translate(-50%, -50%)', opacity: 0.07, objectFit: 'contain', pointerEvents: 'none' }} />
      )}
      <div style={{ position: 'relative', padding: `${17.6 * mm}px ${20 * mm}px ${16 * mm}px` }}>
        {doc.blocks.map((b, i) => renderBlock(b, i, ctx))}
      </div>
    </div>
  );
}
