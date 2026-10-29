import React, { useEffect, useState } from 'react';
import { OnOffToggle } from '../../components/OnOffToggle';
import { getActionMode, subscribeActionMode } from '../../utils/actionMenu';
import { useSidebarPrefs, SidebarPrefs } from '../../utils/sidebarPrefs';
import { saveActionMode, saveSidebarPref, saveNavMode } from '../../utils/uiPrefs';
import { useNavMode } from '../../utils/navModePrefs';

/** Personalizar sistema: aqui entram as preferências de aparência e comportamento do sistema. */
export const TabPersonalizarSistema: React.FC = () => {
  const [mode, setMode] = useState(getActionMode());
  useEffect(() => subscribeActionMode(() => setMode(getActionMode())), []);

  const navMode = useNavMode();
  const prefs = useSidebarPrefs();
  const sidebarOptions: Array<{ key: keyof SidebarPrefs; icon: string; title: string; hint: string }> = [
    { key: 'pageAnim', icon: 'slideshow', title: 'Animação ao abrir páginas', hint: 'Ao clicar numa subsecção do menu, a página surge da esquerda para a direita.' },
    { key: 'dotIcons', icon: 'fiber_manual_record', title: 'Ponto nas subsecções do menu', hint: 'As secções ficam com ícone e as subsecções com um ponto, em vez de ícone.' },
    { key: 'dropAnim', icon: 'expand_more', title: 'Animação ao expandir secções', hint: 'Ao abrir uma secção, as subsecções surgem de cima para baixo; ao fechar, recolhem de baixo para cima.' },
    { key: 'fixedMenu', icon: 'lock', title: 'Menu lateral não expansível', hint: 'Secções e subsecções sempre visíveis, com a seta de expandir sempre à vista; as subsecções usam ponto em vez de ícone.' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[11px] text-slate-500 -mb-2">
        Estas opções ficam guardadas na base de dados desta escola: todos os utilizadores da instituição passam a ver a mesma personalização, sem afectar outras escolas.
      </p>
      <section className="bg-white border border-slate-200 shadow-xs p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[24px] text-[#0b1f3a]">more_vert</span>
            <h3 className="font-bold text-sm uppercase tracking-wider text-[#0b1f3a]">Botões de ações nas tabelas</h3>
          </div>
          <OnOffToggle
            on={mode === 'menu'}
            onChange={(v) => saveActionMode(v ? 'menu' : 'lista')}
            onLabel="Menu"
            offLabel="Listagem"
            ariaLabel="Botões de ações: listagem ou menu"
            height={30}
          />
        </div>
      </section>

      <section className="bg-white border border-slate-200 shadow-xs p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[24px] text-[#0b1f3a]">dashboard_customize</span>
            <h3 className="font-bold text-sm uppercase tracking-wider text-[#0b1f3a]">Navegação das secções</h3>
          </div>
          <OnOffToggle
            on={navMode === 'header'}
            onChange={(v) => saveNavMode(v ? 'header' : 'sidebar')}
            onLabel="Cabeçalho"
            offLabel="Lateral"
            ariaLabel="Catálogo de navegação: menu lateral ou cabeçalho"
            height={30}
          />
        </div>
        <p className="text-[11px] text-slate-500">
          <strong>Lateral</strong> (padrão): o catálogo de secções fica no menu à esquerda.{' '}
          <strong>Cabeçalho</strong>: as secções aparecem numa barra por baixo do cabeçalho e, ao passar o rato numa secção, abrem-se as subsecções para escolher.
        </p>
      </section>

      <section className="bg-white border border-slate-200 shadow-xs p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[24px] text-[#0b1f3a]">menu_open</span>
          <h3 className="font-bold text-sm uppercase tracking-wider text-[#0b1f3a]">Menu lateral e transições</h3>
        </div>
        {sidebarOptions.map((o) => (
          <div key={o.key} className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <span className="material-symbols-outlined text-[20px] text-slate-500 mt-0.5">{o.icon}</span>
              <div className="min-w-0">
                <div className="font-bold text-xs text-[#0b1f3a]">{o.title}</div>
                <div className="text-[11px] text-slate-500">{o.hint}</div>
              </div>
            </div>
            <OnOffToggle
              on={prefs[o.key]}
              onChange={(v) => saveSidebarPref(o.key, v)}
              onLabel="Ligado"
              offLabel="Desligado"
              ariaLabel={o.title}
              height={30}
            />
          </div>
        ))}
      </section>
    </div>
  );
};
