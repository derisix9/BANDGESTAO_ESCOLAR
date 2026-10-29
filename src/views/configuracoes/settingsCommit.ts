import { InstitutionSettings } from '../../types';

/**
 * Mecanismo de gravação única das Configurações.
 *
 * Cada separador (aba/sub-aba/painel) deixou de ter o seu próprio botão "Guardar".
 * Em vez disso, regista aqui uma função que devolve as alterações que tem em mão.
 * O botão principal "Guardar Alterações", no topo do módulo, recolhe essas alterações
 * e grava tudo de uma só vez. A mesma recolha é feita ao mudar de separador, para que
 * nada se perca pelo caminho.
 */
export type SettingsCommitFn = () => Partial<InstitutionSettings>;

export interface SettingsCommitProps {
  /** Regista (ou substitui) a função de recolha do separador activo. */
  registerCommit?: (commit: SettingsCommitFn | null) => void;
}
