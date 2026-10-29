import React, { useMemo, useState } from 'react';
import { AccessRegistry, SectionAccess, SectionMode, User, UserAccess } from '../../types';
import { NAV_GROUPS } from '../../utils/navCatalog';
import {
  ACCESS_SECTIONS,
  SECTION_RULES,
  accessKey,
  buildFullAccess,
  isReadRule,
  isSectionCustomized,
  labelForRule
} from '../../utils/userAccess';

/**
 * EDITOR DE ACESSO POR UTILIZADOR
 * ===============================
 * Três níveis, por utilizador:
 *   1. SECÇÃO  — aparece (ou não) no menu lateral.
 *   2. MODO    — "Só ver" (leitura) ou "Ver e gravar".
 *   3. BOTÕES  — em "Ver e gravar": que ações/botões ficam disponíveis.
 *
 * A lista de secções vem do catálogo do menu (utils/navCatalog.ts) e a lista de
 * botões vem do registo vivo (`settings.accessRegistry`), preenchido pelo motor
 * de acesso à medida que os ecrãs são abertos. Nada aqui está escrito à mão:
 * secções e botões novos aparecem sozinhos.
 */

interface Props {
  user: User;
  registry?: AccessRegistry;
  onClose: () => void;
  /** Recebe o novo acesso já pronto a gravar em `user.access`. */
  onSave: (access: UserAccess) => void;
}

const PORTAL_OWNER: Record<string, string> = { area_estudante: 'aluno', portal_encarregado: 'encarregado' };

import { OnOffToggle } from '../../components/OnOffToggle';

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }> = ({
  on,
  onChange,
  disabled,
  label
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-emerald-600' : 'bg-slate-300'} ${
      disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
        on ? 'translate-x-4' : ''
      }`}
    />
  </button>
);

export const UserAccessEditor: React.FC<Props> = ({ user, registry, onClose, onSave }) => {
  // Estado de trabalho: acesso EFETIVO de cada secção (modelo do perfil + personalizações).
  const [draft, setDraft] = useState<Record<string, SectionAccess>>(() => {
    const full = buildFullAccess(user).sections;
    const out: Record<string, SectionAccess> = {};
    for (const [k, v] of Object.entries(full)) out[k] = { ...v, actions: { ...v.actions } };
    return out;
  });
  // Secções que o Administrador já personalizou (antes ou agora). Só estas são gravadas;
  // as outras continuam a herdar o modelo do perfil.
  const [touched, setTouched] = useState<Set<string>>(
    () => new Set(ACCESS_SECTIONS.filter((s) => isSectionCustomized(user, s.id)).map((s) => accessKey(s.id)))
  );
  const [extra, setExtra] = useState<Record<string, SectionAccess>>(() => {
    const out: Record<string, SectionAccess> = {};
    for (const [k, v] of Object.entries(user.access?.sections || {})) {
      if (!draftHas(k)) out[k] = { ...v, actions: { ...(v.actions || {}) } };
    }
    return out;
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  function draftHas(k: string) {
    return ACCESS_SECTIONS.some((s) => accessKey(s.id) === k);
  }

  const summary = useMemo(() => {
    let enabled = 0;
    let write = 0;
    for (const s of ACCESS_SECTIONS) {
      const a = draft[accessKey(s.id)];
      if (a?.enabled) {
        enabled += 1;
        if (a.mode === 'write') write += 1;
      }
    }
    return { enabled, write, read: enabled - write, total: ACCESS_SECTIONS.length };
  }, [draft]);

  if (user.role === 'admin') {
    return (
      <div data-acl-ignore className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
        <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl text-center">
          <span className="material-symbols-outlined text-[36px] text-emerald-600">verified_user</span>
          <h3 className="font-headline font-bold text-slate-900 mt-2">Administrador Geral</h3>
          <p className="text-xs text-slate-500 mt-1">
            O Administrador Geral tem sempre acesso total — não é possível limitar as suas secções, para nunca bloquear o sistema.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 px-4 py-2 rounded-xl bg-[#0b1f3a] text-white text-xs font-bold cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const registryButtons = (sectionId: string) => registry?.actions?.[accessKey(sectionId)] || {};

  /** Valor mostrado de um botão: o que está gravado; se nada, ligado (comportamento atual). */
  const actionValue = (sectionId: string, key: string): boolean => {
    const v = draft[accessKey(sectionId)]?.actions?.[accessKey(key)];
    return v === undefined ? true : v;
  };

  /** Ao personalizar uma secção pela 1.ª vez, fixa o valor atual dos botões detetados,
   * para que mexer num interruptor não altere os outros. */
  const touch = (sectionId: string) => {
    const sk = accessKey(sectionId);
    setTouched((prev) => {
      if (prev.has(sk)) return prev;
      const next = new Set(prev);
      next.add(sk);
      return next;
    });
  };

  const updateSection = (sectionId: string, patch: (a: SectionAccess) => SectionAccess) => {
    const sk = accessKey(sectionId);
    touch(sectionId);
    setDraft((prev) => {
      const current = prev[sk] || { enabled: false, mode: 'read' as SectionMode, actions: {} };
      const base: SectionAccess = { ...current, actions: { ...current.actions } };
      if (!touched.has(sk)) {
        for (const key of Object.keys(registryButtons(sectionId))) {
          if (base.actions[key] === undefined) base.actions[key] = true;
        }
      }
      return { ...prev, [sk]: patch(base) };
    });
  };

  const setEnabled = (id: string, enabled: boolean) =>
    updateSection(id, (a) => {
      const actions = { ...a.actions };
      // Ao ativar uma secção, coloca-a em modo 'write' (gravação) por predefinição para que
      // o utilizador não fique bloqueado apenas em modo de leitura.
      const mode: SectionMode = enabled ? (a.mode === 'read' ? 'write' : a.mode) : a.mode;
      if (enabled) {
        const rules = SECTION_RULES[id] || [];
        for (const r of rules) {
          if (actions[accessKey(r)] !== false) {
            actions[accessKey(r)] = true;
          }
        }
      }
      return { ...a, enabled, mode, actions };
    });

  const setMode = (id: string, mode: SectionMode) =>
    updateSection(id, (a) => {
      const actions = { ...a.actions };
      if (mode === 'write') {
        const rules = SECTION_RULES[id] || [];
        for (const r of rules) {
          if (actions[accessKey(r)] !== false) {
            actions[accessKey(r)] = true;
          }
        }
      }
      return { ...a, mode, actions };
    });

  const setAction = (id: string, key: string, value: boolean) =>
    updateSection(id, (a) => ({ ...a, actions: { ...a.actions, [accessKey(key)]: value } }));

  const setGroupEnabled = (ids: string[], enabled: boolean) => ids.forEach((id) => setEnabled(id, enabled));

  const resetAll = () => {
    const full = buildFullAccess({ role: user.role }).sections;
    const out: Record<string, SectionAccess> = {};
    for (const [k, v] of Object.entries(full)) out[k] = { ...v, actions: { ...v.actions } };
    setDraft(out);
    setTouched(new Set());
    setExtra({});
  };

  // Secções detetadas em tempo real que não constam do menu.
  const extraIds = Object.entries(registry?.extraSections || {});

  const handleSave = () => {
    const sections: Record<string, SectionAccess> = {};
    for (const s of ACCESS_SECTIONS) {
      const sk = accessKey(s.id);
      if (!touched.has(sk)) continue;
      const a = draft[sk];
      const actions: Record<string, boolean> = { ...a.actions };
      const rules = SECTION_RULES[s.id] || [];
      // Se a secção está em gravação e ativa, autoriza todas as ações não desativadas expressamente
      if (a.mode === 'write' && a.enabled) {
        for (const r of rules) {
          if (actions[accessKey(r)] !== false) {
            actions[accessKey(r)] = true;
          }
        }
      }
      for (const key of Object.keys(registryButtons(s.id))) {
        if (actions[key] === undefined) actions[key] = true;
      }
      sections[sk] = { enabled: a.enabled, mode: a.mode, actions };
    }
    for (const [k, v] of Object.entries(extra)) sections[k] = v;
    // Nota: o Firebase guarda sempre um objeto `access` completo (substitui o anterior), por
    // isso "repor" grava `sections` vazio em vez de apagar o campo.
    onSave({ version: 1, sections });
  };

  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);

  return (
    <div data-acl-ignore className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Acessos do utilizador</div>
            <h3 className="font-headline text-lg font-bold text-slate-900 truncate">{user.name}</h3>
            <p className="text-[11px] text-slate-500">
              Perfil base: <strong>{user.roleTitle || user.role}</strong> · o que não personalizar herda o modelo do perfil.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Fechar">
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Resumo + ferramentas */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="px-2 py-1 rounded-lg bg-white border border-slate-200 font-bold text-slate-700">
            {summary.enabled} de {summary.total} secções ativas
          </span>
          <span className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 font-bold text-emerald-800">
            {summary.write} ver e gravar
          </span>
          <span className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 font-bold text-amber-800">
            {summary.read} só ver
          </span>
          <div className="flex-1" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar secção ou botão..."
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs w-56 outline-none focus:border-[#0b1f3a]"
          />
          <button
            type="button"
            onClick={resetAll}
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 cursor-pointer"
            title="Volta ao que o perfil dá por omissão"
          >
            Repor modelo do perfil
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">
          {NAV_GROUPS.map((group) => {
            const owner = PORTAL_OWNER[group.key];
            if (owner && owner !== user.role) return null;
            const sections = ACCESS_SECTIONS.filter((s) => s.groupKey === group.key).filter((s) => {
              if (matches(s.label)) return true;
              const rules = (SECTION_RULES[s.id] || []).some((r) => matches(labelForRule(r)));
              const btns = Object.values(registryButtons(s.id)).some((b) => matches(b.label));
              return rules || btns;
            });
            if (sections.length === 0) return null;
            const ids = sections.map((s) => s.id);
            const allOn = ids.every((id) => draft[accessKey(id)]?.enabled);

            return (
              <section key={group.key}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">{group.icon}</span>
                    {group.label}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setGroupEnabled(ids, !allOn)}
                    className="text-[11px] font-bold text-[#0b1f3a] hover:text-[#ac332b] cursor-pointer"
                  >
                    {allOn ? 'Desativar todas' : 'Ativar todas'}
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                  {sections.map((s) => {
                    const sk = accessKey(s.id);
                    const a = draft[sk] || { enabled: false, mode: 'read' as SectionMode, actions: {} };
                    const isOpen = !!open[sk] || (!!q && !matches(s.label));
                    const rules = SECTION_RULES[s.id] || [];
                    const buttons = Object.entries(registryButtons(s.id));
                    const canExpand = a.enabled && a.mode === 'write';

                    return (
                      <div key={s.id} className={a.enabled ? 'bg-white' : 'bg-slate-50/70'}>
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <Switch on={a.enabled} onChange={(v) => setEnabled(s.id, v)} label={`Ativar ${s.label}`} />
                          <span className={`material-symbols-outlined text-[18px] ${a.enabled ? 'text-[#0b1f3a]' : 'text-slate-400'}`}>
                            {s.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-bold truncate ${a.enabled ? 'text-slate-900' : 'text-slate-400'}`}>
                              {s.label}
                            </div>
                            {touched.has(sk) && (
                              <div className="text-[10px] text-[#ac332b] font-semibold">Personalizado</div>
                            )}
                          </div>

                          {/* Modo: OFF = leitura, ON = gravação */}
                          <OnOffToggle
                            on={a.mode === 'write'}
                            onChange={(v) => setMode(s.id, v ? 'write' : 'read')}
                            onLabel="Gravação"
                            offLabel="Leitura"
                            disabled={!a.enabled}
                            ariaLabel={`Modo de ${s.label}: leitura ou gravação`}
                          />

                          <button
                            type="button"
                            disabled={!canExpand}
                            onClick={() => setOpen((p) => ({ ...p, [sk]: !p[sk] }))}
                            className={`p-1 rounded-lg ${canExpand ? 'text-slate-500 hover:bg-slate-100 cursor-pointer' : 'text-slate-300 cursor-not-allowed'}`}
                            title={canExpand ? 'Escolher botões' : 'Ative o modo Gravação para escolher botões'}
                          >
                            <span className={`material-symbols-outlined text-[20px] transition-transform ${isOpen && canExpand ? 'rotate-180' : ''}`}>
                              expand_more
                            </span>
                          </button>
                        </div>

                        {isOpen && canExpand && (
                          <div className="px-4 pb-3 pl-16 flex flex-col gap-3">
                            {rules.length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">Ações do sistema</div>
                                <div className="flex flex-col gap-1">
                                  {rules.map((rule) => {
                                    const on = a.actions[accessKey(rule)] ?? false;
                                    return (
                                      <label key={rule} className="flex items-center gap-2.5 text-[11px] text-slate-700">
                                        <Switch on={on} onChange={(v) => setAction(s.id, rule, v)} label={labelForRule(rule)} />
                                        <span className="flex-1">{labelForRule(rule)}</span>
                                        {isReadRule(rule) && (
                                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-bold uppercase">consulta</span>
                                        )}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div>
                              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">
                                Botões detetados no ecrã
                              </div>
                              {buttons.length === 0 ? (
                                <p className="text-[11px] text-slate-400">
                                  Ainda nenhum. Abra esta secção uma vez e os botões de gravação aparecem aqui sozinhos.
                                </p>
                              ) : (
                                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                                  {buttons
                                    .filter(([, b]) => matches(b.label) || matches(s.label))
                                    .map(([key, b]) => (
                                      <label key={key} className="flex items-center gap-2.5 text-[11px] text-slate-700">
                                        <Switch
                                          on={actionValue(s.id, key)}
                                          onChange={(v) => setAction(s.id, key, v)}
                                          label={b.label}
                                        />
                                        <span className="flex-1 truncate" title={b.label}>{b.label}</span>
                                        {b.destructive && (
                                          <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[9px] font-bold uppercase">
                                            destrutivo
                                          </span>
                                        )}
                                      </label>
                                    ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {/* Secções novas detetadas (fora do menu) */}
          {extraIds.length > 0 && (
            <section>
              <h4 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">new_releases</span>
                Secções novas detetadas
              </h4>
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {extraIds.map(([key, meta]) => {
                  const a = extra[key] || { enabled: false, mode: 'read' as SectionMode, actions: {} };
                  const set = (patch: Partial<SectionAccess>) => setExtra((p) => ({ ...p, [key]: { ...a, ...patch } }));
                  return (
                    <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                      <Switch on={a.enabled} onChange={(v) => set({ enabled: v })} label={`Ativar ${meta.label}`} />
                      <div className="flex-1 min-w-0 text-xs font-bold text-slate-800 truncate">{meta.label}</div>
                      <OnOffToggle on={a.mode === 'write'} onChange={(v) => set({ mode: v ? 'write' : 'read' })} onLabel="Gravação" offLabel="Leitura" disabled={!a.enabled} ariaLabel={`Modo de ${meta.label}`} />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <p className="text-[10px] text-slate-500 max-w-md">
            Controla o que o utilizador vê e usa na interface. Não substitui regras de segurança no servidor.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} className="px-5 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">
              Guardar acessos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
