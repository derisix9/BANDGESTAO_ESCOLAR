import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PImage, PQr, PText, Prim, Scene } from '../scene';
import { FONT_STACK, fitSize } from '../scene';
import type { ImageSlots } from '../images';

/** 1 mm em píxeis de ecrã a 100 % (96 dpi). */
export const MM_PX = 3.7795;
const PT_PX = 96 / 72;

export interface SceneViewProps {
  scene: Scene;
  images: ImageSlots;
  /** Foto da pessoa (slot "foto"). */
  photo?: string;
  /** Textos alterados pelo utilizador, por id da primitiva. */
  overrides?: Record<string, string>;
  /** Presente = os textos tornam-se editáveis no próprio documento. */
  onEdit?: (id: string, text: string, scope: 'model' | 'doc') => void;
  /** Clique numa imagem substituível (foto, brasão, logótipo, selo…). */
  onPickImage?: (slot: string) => void;
  /** Ampliação (1 = tamanho real no ecrã). */
  zoom?: number;
  /** Sombra e cantos arredondados de pré-visualização (desligado na impressão). */
  chrome?: boolean;
}

function QrImg({ prim, mm }: { prim: PQr; mm: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(prim.value || 'x', {
      margin: 0, width: 300, errorCorrectionLevel: 'M',
      color: { dark: prim.fg || '#000000', light: prim.bg || '#ffffff' }
    }).then((u) => { if (alive) setSrc(u); }).catch(() => undefined);
    return () => { alive = false; };
  }, [prim.value, prim.fg, prim.bg]);
  return src ? <img src={src} alt="QR de validação" style={{ position: 'absolute', left: prim.x * mm, top: prim.y * mm, width: prim.w * mm, height: prim.h * mm, imageRendering: 'pixelated' }} /> : null;
}

function ImageNode({ p, mm, src, onPick }: { p: PImage; mm: number; src?: string; onPick?: (slot: string) => void }) {
  const box: React.CSSProperties = {
    position: 'absolute', left: p.x * mm, top: p.y * mm, width: p.w * mm, height: p.h * mm,
    borderRadius: p.round ? '50%' : p.r ? p.r * mm : undefined, overflow: 'hidden', opacity: p.opacity ?? 1,
    border: p.stroke ? `${Math.max(0.2, p.sw ?? 0.3) * mm}px solid ${p.stroke}` : undefined, boxSizing: 'border-box',
    cursor: onPick ? 'pointer' : undefined
  };
  if (!src) {
    if (!onPick) return null;
    return (
      <div data-no-print style={{ ...box, border: '1px dashed #94a3b8', background: 'rgba(148,163,184,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 10, fontFamily: 'Arial', textAlign: 'center' }} onClick={() => onPick(p.slot)} title={`Carregar imagem: ${p.slot}`}>
        {p.slot === 'foto' ? 'Foto' : p.slot}
      </div>
    );
  }
  return (
    <div style={box} onClick={onPick ? () => onPick(p.slot) : undefined} title={onPick ? 'Clique para substituir a imagem' : undefined}>
      <img src={src} alt={p.slot} draggable={false} style={{ width: '100%', height: '100%', objectFit: p.fit === 'contain' ? 'contain' : p.fit === 'stretch' ? 'fill' : 'cover', display: 'block' }} />
    </div>
  );
}

function TextNode({ p, mm, zoom, value, onEdit }: { p: PText; mm: number; zoom: number; value: string; onEdit?: SceneViewProps['onEdit'] }) {
  const size = fitSize({ ...p, text: value }) * PT_PX * zoom;
  const justify = p.align === 'center' ? 'center' : p.align === 'right' ? 'flex-end' : 'flex-start';
  const alignV = p.valign === 'top' ? 'flex-start' : p.valign === 'bottom' ? 'flex-end' : 'center';
  const editable = !!onEdit && !!p.id && p.editable !== false;
  return (
    <div
      data-edit={editable ? 'true' : undefined}
      style={{
        position: 'absolute', left: p.x * mm, top: p.y * mm, width: p.w * mm, height: p.h * mm,
        display: 'flex', justifyContent: justify, alignItems: alignV, overflow: 'visible'
      }}
    >
      <div
        contentEditable={editable}
        data-doc-field="true"
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={editable ? (e) => {
          const next = e.currentTarget.innerText.replace(/\u00a0/g, ' ').replace(/\n$/, '');
          if (next !== value) onEdit!(p.id!, next, p.scope === 'model' ? 'model' : 'doc');
        } : undefined}
        style={{
          width: '100%', fontFamily: FONT_STACK[p.font || 'sans'], fontSize: size, fontWeight: p.bold ? 700 : 400,
          fontStyle: p.italic ? 'italic' : 'normal', color: p.color || '#111', textAlign: p.align || 'left',
          letterSpacing: p.spacing ? `${p.spacing * 0.0138 * zoom}em` : undefined, textTransform: p.caps ? 'uppercase' : undefined,
          lineHeight: p.lineH || 1.12, whiteSpace: p.shrink ? 'nowrap' : 'pre-wrap', outline: 'none', cursor: editable ? 'text' : 'default'
        }}
      >
        {value}
      </div>
    </div>
  );
}

function renderPrim(p: Prim, i: number, ctx: { mm: number; zoom: number } & Pick<SceneViewProps, 'images' | 'photo' | 'overrides' | 'onEdit' | 'onPickImage'>) {
  const { mm, zoom } = ctx;
  switch (p.k) {
    case 'rect': {
      const bg = p.fill ? (p.fill2 ? `linear-gradient(${p.ang ?? 135}deg, ${p.fill}, ${p.fill2})` : p.fill) : 'transparent';
      return (
        <div key={i} style={{
          position: 'absolute', left: p.x * mm, top: p.y * mm, width: p.w * mm, height: p.h * mm, background: bg,
          border: p.stroke ? `${Math.max(0.2, (p.sw ?? 0.3) * mm)}px ${p.dash ? 'dashed' : 'solid'} ${p.stroke}` : undefined,
          borderRadius: p.r ? p.r * mm : undefined, opacity: p.opacity ?? 1, boxSizing: 'border-box'
        }} />
      );
    }
    case 'ellipse':
      return (
        <div key={i} style={{
          position: 'absolute', left: p.x * mm, top: p.y * mm, width: p.w * mm, height: p.h * mm, borderRadius: '50%',
          background: p.fill || 'transparent', opacity: p.opacity ?? 1, boxSizing: 'border-box',
          border: p.stroke ? `${Math.max(0.2, (p.sw ?? 0.3) * mm)}px solid ${p.stroke}` : undefined
        }} />
      );
    case 'line':
      return null; // desenhadas todas juntas numa camada SVG
    case 'text': {
      const raw = p.id ? ctx.overrides?.[p.id] : undefined;
      return <TextNode key={i} p={p} mm={mm} zoom={zoom} value={raw ?? p.text} onEdit={ctx.onEdit} />;
    }
    case 'image': {
      const src = p.slot === 'foto' ? ctx.photo : ctx.images[p.slot];
      return <ImageNode key={i} p={p} mm={mm} src={src} onPick={ctx.onPickImage} />;
    }
    case 'qr':
      return <QrImg key={i} prim={p} mm={mm} />;
  }
}

/** Desenha uma Cena em milímetros reais. A mesma cena é exportada para PPTX, por isso é fiel ao ficheiro. */
export function SceneView({ scene, images, photo, overrides, onEdit, onPickImage, zoom = 1, chrome = true }: SceneViewProps) {
  const mm = MM_PX * zoom;
  const lines = scene.prims.filter((p): p is Extract<Prim, { k: 'line' }> => p.k === 'line');
  const ctx = { mm, zoom, images, photo, overrides, onEdit, onPickImage };
  return (
    <div
      className="studio-scene"
      style={{
        position: 'relative', width: scene.w * mm, height: scene.h * mm, background: '#fff', overflow: 'hidden', flexShrink: 0,
        boxShadow: chrome ? '0 6px 22px rgba(15,23,42,.22), 0 1px 3px rgba(15,23,42,.18)' : undefined,
        borderRadius: scene.radius != null ? scene.radius * mm : chrome && scene.w < 100 ? 3.2 * mm : undefined
      }}
    >
      {scene.prims.map((p, i) => renderPrim(p, i, ctx))}
      {lines.length > 0 && (
        <svg width={scene.w * mm} height={scene.h * mm} viewBox={`0 0 ${scene.w} ${scene.h}`} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
          {lines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.stroke} strokeWidth={l.sw ?? 0.3} strokeDasharray={l.dash ? '1.2 1' : undefined} />
          ))}
        </svg>
      )}
    </div>
  );
}
