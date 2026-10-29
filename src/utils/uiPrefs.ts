/**
 * Personalizar sistema — ponte entre as definições da escola (base de dados) e a interface.
 *
 *  - `applyUiPrefs(settings.uiPrefs)` é chamado pelo App sempre que as definições mudam (login, Realtime, edição);
 *    assim todos os utilizadores da escola vêem a mesma personalização e outras escolas não são afectadas.
 *  - `saveUiPrefs(...)` grava em `settings.uiPrefs` (documento `settings` da escola em `institution_docs`;
 *    só quem pode editar definições consegue gravar: a base de dados, via RLS, é que decide).
 */
import type { UiPrefs } from '../types';
import { dbService } from '../services/db';
import { applySidebarPrefs, getSidebarPrefs, SidebarPrefs } from './sidebarPrefs';
import { applyActionMode, getActionMode, ActionMode } from './actionMenu';
import { applyNavMode, getNavMode, NavMode } from './navModePrefs';

export function applyUiPrefs(p?: UiPrefs | null) {
  applySidebarPrefs(p?.sidebar);
  applyActionMode(p?.actionMode);
  applyNavMode(p?.navMode);
}

function currentPrefs(): UiPrefs {
  const stored = dbService.getSettings()?.uiPrefs || {};
  return {
    actionMode: stored.actionMode ?? getActionMode(),
    navMode: stored.navMode ?? getNavMode(),
    sidebar: { ...getSidebarPrefs(), ...(stored.sidebar || {}) },
  };
}

function saveUiPrefs(next: UiPrefs) {
  dbService.updateSettings({ uiPrefs: next });
  applyUiPrefs(next); // efeito imediato para quem alterou; os restantes recebem pela sincronização
}

export function saveActionMode(mode: ActionMode) {
  saveUiPrefs({ ...currentPrefs(), actionMode: mode });
}

export function saveSidebarPref<K extends keyof SidebarPrefs>(key: K, value: SidebarPrefs[K]) {
  const cur = currentPrefs();
  saveUiPrefs({ ...cur, sidebar: { ...cur.sidebar, [key]: value } });
}

export function saveNavMode(mode: NavMode) {
  saveUiPrefs({ ...currentPrefs(), navMode: mode });
}
