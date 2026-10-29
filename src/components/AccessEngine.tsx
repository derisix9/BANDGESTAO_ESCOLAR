import React, { useEffect, useRef } from 'react';
import { AccessRegistry, DetectedAction, User } from '../types';
import { dbService } from '../services/db';
import {
  accessKey,
  canUserAction,
  classifyButton,
  getSection,
  sectionIdForView,
  setActiveAccessSection,
  sectionAccessFor,
  slugifyAction
} from '../utils/userAccess';

/**
 * MOTOR DE ACESSO EM TEMPO REAL
 * =============================
 * Vigia o ecrã (MutationObserver) e, para cada botão de GRAVAÇÃO que aparece:
 *
 *   • DETETA-O e regista-o em `settings.accessRegistry` — é assim que botões
 *     novos entram sozinhos na lista de permissões, sem tocar em código;
 *   • APLICA o acesso do utilizador: em modo "só ver" esconde-os todos; em modo
 *     "ver e gravar" esconde apenas os que o Administrador desligou.
 *
 * Botões de consulta/navegação (fechar, cancelar, pesquisar, imprimir, abas...)
 * nunca são tocados. Para marcar um botão à mão, use atributos no JSX:
 *   data-acl-action="chave"  data-acl-label="Nome"  data-acl-kind="write|read"
 * e `data-acl-ignore` num contentor para o excluir por completo.
 *
 * Nota: isto atua sobre a interface. Não substitui regras no servidor.
 */

const STYLE_ID = 'acl-engine-style';
const BLOCKED_ATTR = 'data-acl-blocked';
const SELECTOR = 'button, [role="button"], input[type="submit"], input[type="button"]';
const MAX_ACTIONS_PER_SECTION = 120;

interface Props {
  view: string;
  user: User | null;
}

interface Found {
  key: string;
  label: string;
  icon?: string;
  destructive: boolean;
}

function readButton(el: HTMLElement): (Found & { kind: 'write' | 'read' | 'ignore' }) | null {
  // Zonas que nunca se controlam: menu, barra superior, modais globais, marcadas à mão.
  if (el.closest('[data-acl-ignore], aside, nav, header')) return null;
  if (el.getAttribute('role') === 'tab') return null;

  // Rótulo = texto do botão sem o nome do ícone (Material Symbols escreve o nome em texto).
  const iconEl = el.querySelector('.material-symbols-outlined, .material-icons');
  const icon = iconEl?.textContent?.trim() || undefined;
  let label = '';
  if (el instanceof HTMLInputElement) {
    label = el.value || '';
  } else {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.material-symbols-outlined, .material-icons, svg').forEach((n) => n.remove());
    label = (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }
  if (!label) label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
  label = label.replace(/\s*\d[\d.,\s]*$/g, '').trim(); // remove contadores no fim ("Novo (3)")
  if (label.length > 48) label = label.slice(0, 48).trim();

  // Marcação manual tem prioridade sobre a heurística.
  const manualKey = el.getAttribute('data-acl-action');
  const manualKind = el.getAttribute('data-acl-kind') as 'write' | 'read' | null;
  const manualLabel = el.getAttribute('data-acl-label');

  const cls = classifyButton(manualLabel || label, icon);
  const kind = manualKind || cls.kind;
  const finalLabel = manualLabel || label || icon || '';
  if (!finalLabel) return null;

  const key = manualKey || `btn:${slugifyAction(finalLabel) || slugifyAction(icon || '') || 'acao'}`;
  return { key, label: finalLabel, icon, destructive: cls.destructive, kind };
}

function setBlocked(el: HTMLElement, blocked: boolean) {
  const isBlocked = el.hasAttribute(BLOCKED_ATTR);
  if (blocked && !isBlocked) {
    el.setAttribute(BLOCKED_ATTR, '1');
    if ('disabled' in el && !(el as HTMLButtonElement).disabled) {
      (el as HTMLButtonElement).disabled = true;
      el.setAttribute('data-acl-disabled', '1');
    }
  } else if (!blocked && isBlocked) {
    el.removeAttribute(BLOCKED_ATTR);
    if (el.getAttribute('data-acl-disabled') === '1') {
      (el as HTMLButtonElement).disabled = false;
      el.removeAttribute('data-acl-disabled');
    }
  }
}

export const AccessEngine: React.FC<Props> = ({ view, user }) => {
  const sectionId = sectionIdForView(view);
  const userRef = useRef(user);
  userRef.current = user;
  const pending = useRef<Record<string, Record<string, DetectedAction>>>({});
  const flushTimer = useRef<number | null>(null);

  // CSS que esconde os botões bloqueados.
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `[${BLOCKED_ATTR}="1"]{display:none !important;}`;
    document.head.appendChild(style);
  }, []);

  // Informa o motor de regras sobre a secção ativa.
  useEffect(() => {
    setActiveAccessSection(sectionId);
    return () => setActiveAccessSection(null);
  }, [sectionId]);

  useEffect(() => {
    const flush = () => {
      flushTimer.current = null;
      const batch = pending.current;
      pending.current = {};
      if (Object.keys(batch).length === 0) return;
      try {
        const current: AccessRegistry = dbService.getSettings()?.accessRegistry || {
          actions: {},
          extraSections: {}
        };
        const next: AccessRegistry = {
          actions: { ...current.actions },
          extraSections: { ...current.extraSections }
        };
        let changed = false;
        for (const [sid, found] of Object.entries(batch)) {
          if (sid === '__extra__') {
            for (const [id, meta] of Object.entries(found as any)) {
              const k = accessKey(id);
              if (!next.extraSections[k]) {
                next.extraSections[k] = meta as any;
                changed = true;
              }
            }
            continue;
          }
          const sk = accessKey(sid);
          const existing = { ...(next.actions[sk] || {}) };
          for (const [key, meta] of Object.entries(found)) {
            const k = accessKey(key);
            if (!existing[k] && Object.keys(existing).length < MAX_ACTIONS_PER_SECTION) {
              existing[k] = meta;
              changed = true;
            }
          }
          next.actions[sk] = existing;
        }
        if (changed) dbService.updateSettings({ accessRegistry: next });
      } catch (e) {
        console.warn('Não foi possível registar botões detetados:', e);
      }
    };

    const queue = (sid: string, key: string, meta: DetectedAction) => {
      const known = dbService.getSettings()?.accessRegistry?.actions?.[accessKey(sid)]?.[accessKey(key)];
      if (known || pending.current[sid]?.[key]) return;
      (pending.current[sid] ||= {})[key] = meta;
      if (flushTimer.current == null) flushTimer.current = window.setTimeout(flush, 1500);
    };

    // Secção que não consta do catálogo do menu → fica registada como "nova".
    if (!getSection(sectionId) && sectionId !== 'configuracoes') {
      const known = dbService.getSettings()?.accessRegistry?.extraSections?.[accessKey(sectionId)];
      if (!known) {
        (pending.current['__extra__'] ||= {} as any)[sectionId] = {
          label: sectionId,
          firstSeen: new Date().toISOString()
        };
        flushTimer.current = window.setTimeout(flush, 1500);
      }
    }

    const apply = () => {
      const u = userRef.current;
      if (!u) return;
      const isAdmin = u.role === 'admin';
      const access = sectionAccessFor(u, sectionId);
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
        const info = readButton(el);
        if (!info || info.kind === 'ignore') return;

        if (info.kind === 'write') {
          queue(sectionId, info.key, {
            label: info.label,
            icon: info.icon,
            destructive: info.destructive,
            firstSeen: new Date().toISOString()
          });
          if (isAdmin) return setBlocked(el, false);
          // Modo leitura esconde tudo o que grava; modo gravação esconde só o desligado.
          const allowed = access.mode === 'write' && canUserAction(u, sectionId, info.key, info.destructive);
          setBlocked(el, !allowed);
        } else {
          setBlocked(el, false);
        }
      });
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };

    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // Reaplica quando o acesso do utilizador muda em tempo real.
    const unsub = dbService.subscribe(schedule);

    return () => {
      observer.disconnect();
      unsub();
      cancelAnimationFrame(raf);
      if (flushTimer.current != null) {
        clearTimeout(flushTimer.current);
        flush();
      }
    };
  }, [sectionId, user?.id, user?.role, user?.access]);

  return null;
};
