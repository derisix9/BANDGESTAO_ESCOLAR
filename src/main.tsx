import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { CookieConsent } from './components/CookieConsent';
import { NoticeHost } from './components/Notice';
import './index.css';
import './styles/global-fields.css'; // campos de texto: fundo #9fbad8, texto preto, placeholder claro (regra global)
import './styles/global-polish.css'; // azul do menu em pesquisas/botões/idioma, selects mais altos (vem depois dos outros)
import './styles/notices.css'; // caixas de aviso globais (Notice.tsx)
import './styles/bm-overrides.css'; // fonte Arial Narrow, tons de botões (data-tone), hoje no calendário
import './styles/mobile-app.css'; // app móvel: barra inferior, menu em folha, tabelas em cartões, modais em folha (só < 1024px)
import { initActionMenu } from './utils/actionMenu';
import { initUiTheme } from './theme/uiTheme';
import { initColorMode } from './theme/colorMode';
import { initPageBackground } from './theme/pageBackground';
import { enableResizableModals } from './utils/resizableModals';
import { enableStickyTableHeaders } from './utils/stickyTableHeaders';
import { enableTablePagination } from './utils/tablePagination';
import { enableTableEnhancements } from './utils/tableEnhancements';
import { enableDialogButtons } from './utils/dialogButtons';
import { enableMobileWrap } from './utils/mobileWrap';
import { enableMobileTables } from './utils/mobileTables';
import { installCardHighlight } from './utils/cardHighlight';
import { startAutoTranslate } from './i18n/autoTranslate';
import { protectIconsFromBrowserTranslate } from './utils/noTranslateIcons';
import { initErrorReporter } from './services/errorReporter';

// Monitorização de erros do browser (erros não tratados, promessas rejeitadas): ver src/services/errorReporter.ts.
initErrorReporter();

// Destaque animado dos cards ao passar o rato (cor da borda / inversão branco-preto).
installCardHighlight();

// Aplica o tema visual escolhido (Padrão ou Laravel) antes do primeiro render,
// para que a página nunca pisque com o tema errado.
initUiTheme();

// Janela de ligação ao Google Drive (backup para a nuvem): quando o Google devolve aqui o utilizador, avisa a janela
// principal (BroadcastChannel + localStorage) e fecha-se. Ver src/views/configuracoes/ExternalBackup.tsx.
try {
  const q = new URLSearchParams(window.location.search);
  const r = q.get('backup-drive');
  if (r === 'ok' || r === 'erro') {
    const msg = { type: 'bandmed-backup-drive', result: r, msg: q.get('msg') || '' };
    try { const ch = new BroadcastChannel('bandmed-backup-drive'); ch.postMessage(msg); ch.close(); } catch { /* sem BroadcastChannel */ }
    try { localStorage.setItem('bandmed:backup-drive-result', JSON.stringify({ ...msg, at: Date.now() })); } catch { /* sem localStorage */ }
    window.close();   // só fecha janelas abertas pela própria app
    q.delete('backup-drive'); q.delete('msg');
    window.history.replaceState({}, '', window.location.pathname + (q.toString() ? `?${q}` : '') + window.location.hash);
  }
} catch { /* ignora */ }

// Modo claro/escuro (botão sol/lua no cabeçalho). O modo escuro é só de ecrã:
// ao imprimir, o documento sai sempre claro (ver src/styles/theme-dark.css).
initColorMode();

// Imagem de fundo opcional por modo. Sem ficheiro, nada muda.
initPageBackground();

// Comportamentos globais de layout (ver src/styles/global-layout.css):
// modais redimensionáveis e cabeçalhos de tabela congelados.
enableResizableModals();
enableStickyTableHeaders();
enableTablePagination(); // todas as tabelas com mais de 25 registos: 25 de cada vez, botões ‹ e › (ver src/utils/tablePagination.ts)
enableDialogButtons(); // botões de formulários/modais/diálogos: Cancelar sem fundo, os outros com fundo e letra branca (ver src/utils/dialogButtons.ts)
enableTableEnhancements(); // linhas alternadas, botões de ação coloridos, seleção de linhas e eliminação em lote (ver src/utils/tableEnhancements.ts)
initActionMenu(); // Personalizar sistema → botões de ações em modo Menu (⋮) ou Listagem (ver src/utils/actionMenu.ts)
protectIconsFromBrowserTranslate(); // ícones nunca são traduzidos pelo tradutor do navegador (ver src/utils/noTranslateIcons.ts)
startAutoTranslate(); // idioma Inglês: traduz a interface inteira (ver src/i18n/autoTranslate.ts)
enableMobileTables(); // telemóvel: tabelas com poucas colunas viram cartões (ver src/utils/mobileTables.ts)
enableMobileWrap(); // telemóvel: filas de botões/cards que não cabem passam a quebrar linha

// PWA: instalável e com o ecrã da app disponível sem internet (public/sw.js). Só em produção,
// para o modo de desenvolvimento nunca servir ficheiros antigos da cache.
if ('serviceWorker' in navigator && (import.meta as any).env?.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <CookieConsent />
    <NoticeHost />
  </StrictMode>,
);
