/**
 * REFERÊNCIAS MULTICAIXA
 * ======================
 *
 * ATENÇÃO — mudança importante: o BandMed já NÃO inventa referências no navegador.
 *
 * Uma referência que o ATM / Multicaixa Express aceita só pode ser emitida pelo fornecedor de pagamentos da escola
 * (hoje: ProxyPay, ligada pela própria escola em Configurações → Integrações). A Edge Function `payments` pede a
 * referência ao fornecedor, grava-a na factura (`multicaixaEntity` + `multicaixaRef`) e, quando a factura é paga,
 * o fornecedor avisa `payments-webhook`, que regista o pagamento sozinho. Ver docs/PAGAMENTOS_REFERENCIA.md.
 *
 * A antiga função que calculava um número com um dígito de controlo próprio gerava referências que NENHUM
 * terminal reconhecia — e pior, davam a ideia de que se podia pagar. Por isso devolve sempre "sem referência":
 * enquanto a escola não ligar o fornecedor, a factura mostra "Balcão / Caixa", que é a verdade.
 *
 * As funções mantêm-se (com a mesma assinatura) para não partir os sítios que ainda as chamam.
 */

/** Normaliza uma entidade Multicaixa (só texto aparado). */
export function normalizeEmisEntity(entity?: string): string {
  return (entity || '').trim();
}

/** @deprecated Não gera referências. Use a integração de pagamentos por referência (Edge Function `payments`). */
export function buildMulticaixaReference(_invoiceNumber?: string, _amountKz?: number, _emisEntity?: string): string {
  return '';
}

/** @deprecated Devolve sempre {} — a entidade e a referência vêm do fornecedor, depois de gerada a referência. */
export function buildMulticaixaFields(
  _invoiceNumber?: string,
  _amountKz?: number,
  _emisEntity?: string
): { multicaixaEntity?: string; multicaixaRef?: string } {
  return {};
}
