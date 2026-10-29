/**
 * FUNCIONALIDADES AVANÇADAS POR ESCOLA (definidas pelo Super Admin no Admin Master)
 * ================================================================================
 * Duas áreas de configuração avançada são controladas escola a escola:
 *
 *   integracoes        Configurações → Integrações
 *   backup_automatico  Configurações → Segurança & BD → Cópia diária para a nuvem
 *
 * Modos:  'oculto' (a escola não vê — omissão)  ·  'leitura' (vê sem gravar)  ·  'gravacao' (configura tudo).
 *
 * O servidor é a fonte da verdade (tabela school_feature_modes, migração 0023). Para o backup
 * automático a Edge Function school-backups também recusa escrita fora do modo 'gravacao'.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export type FeatureMode = 'oculto' | 'leitura' | 'gravacao';
export type FeatureKey = 'integracoes' | 'backup_automatico';

const DEFAULTS: Record<FeatureKey, FeatureMode> = { integracoes: 'oculto', backup_automatico: 'oculto' };

let modes: Record<FeatureKey, FeatureMode> = { ...DEFAULTS };
let loaded = false;
const listeners = new Set<() => void>();

const isMode = (v: unknown): v is FeatureMode => v === 'oculto' || v === 'leitura' || v === 'gravacao';
const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignora */ } });

export function onFeatureModesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Carrega os modos desta escola (depois do login). Sem ligação / erro → mantém o mais restrito. */
export async function initFeatureModes(): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('my_feature_modes');
    if (!error && data) {
      modes = {
        integracoes: isMode((data as any).integracoes) ? (data as any).integracoes : DEFAULTS.integracoes,
        backup_automatico: isMode((data as any).backup_automatico) ? (data as any).backup_automatico : DEFAULTS.backup_automatico
      };
      loaded = true;
      emit();
    }
  } catch { /* sem rede: modo restrito */ }
}

export function resetFeatureModes() {
  modes = { ...DEFAULTS };
  loaded = false;
  emit();
}

export function getFeatureMode(key: FeatureKey): FeatureMode {
  return modes[key] ?? 'oculto';
}

/** Secções do menu/Configurações que dependem de um modo: chave da secção → área. */
const SECTION_FEATURE: Record<string, FeatureKey> = { 'configuracoes/integracoes': 'integracoes' };

/** A secção está oculta para esta escola por decisão do Super Admin? (usada em canViewSection) */
export function isFeatureSectionHidden(sectionId: string): boolean {
  const key = SECTION_FEATURE[sectionId];
  return !!key && getFeatureMode(key) === 'oculto';
}

/** Hook: modo atual de uma área, a re-renderizar quando o servidor responde ou o Super Admin altera. */
export function useFeatureMode(key: FeatureKey): { mode: FeatureMode; loaded: boolean; readOnly: boolean; hidden: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    const off = onFeatureModesChange(() => tick((n) => n + 1));
    if (!loaded) void initFeatureModes();
    return off;
  }, []);
  const mode = getFeatureMode(key);
  return { mode, loaded, readOnly: mode === 'leitura', hidden: mode === 'oculto' };
}

export const READ_ONLY_NOTICE = 'Somente leitura — esta área é configurada pelo Admin Master (BandMed).';
