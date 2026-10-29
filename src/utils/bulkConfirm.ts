/**
 * Flag partilhada: enquanto uma ELIMINAÇÃO EM LOTE (src/utils/tableEnhancements.ts) está a correr,
 * as caixas de confirmação individuais (showAppConfirm / window.confirm) respondem "sim"
 * automaticamente — o utilizador já confirmou UMA vez para todos os registos selecionados.
 */
let active = false;
export const setBulkAutoConfirm = (v: boolean) => { active = v; };
export const isBulkAutoConfirm = () => active;
