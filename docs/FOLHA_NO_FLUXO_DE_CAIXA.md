# Folha de pagamento no fluxo de caixa

## O que já entrava
O **salário líquido pago** de cada recibo (estado «pago») sai do livro de caixa no mês da data de pagamento, na categoria
«Folha de pagamento» (`buildLedger` em `src/utils/financeExtras.ts`). Recibos pendentes e cancelados não entram. O canal
(numerário, transferência, Multicaixa, cheque) decide se o dinheiro sai da gaveta da caixa ou do banco.

## O que faltava e agora existe
O custo da folha não é só o líquido: a escola entrega ainda ao Estado o **INSS** (trabalhador + entidade patronal) e o **IRT retido**.
Esses valores não saem no dia do salário. Agora:

| Peça | Onde |
|---|---|
| Cálculo dos encargos por mês de referência | `src/utils/payrollCashFlow.ts` (`payrollChargesDue`) |
| Botão «Gerar encargos INSS/IRT» | Despesas & Fluxo de Caixa (`FinanceiroAvancadoView.tsx`) |
| Gravação como contas a pagar | `dbService.syncPayrollChargePayables()` |
| Previsão de saídas da folha | tabela «Folha de pagamento: previsão de saídas», no mesmo ecrã |

**Como funciona**
- Cada mês de referência com recibos (não cancelados) gera até duas contas a pagar: `INSS` (3% do trabalhador, lido do recibo, mais
  8% patronal sobre o bruto, pelas taxas configuradas) e `AGT` (IRT retido).
- O id é estável (`enc-inss-AAAA-MM`, `enc-irt-AAAA-MM`): carregar no botão outra vez **não duplica**. Se a folha mudar e a conta
  ainda estiver por pagar, o valor é actualizado. **Contas já pagas nunca são alteradas**; se o valor da folha mudar depois do pagamento,
  o ajuste é manual.
- Só entram no fluxo de caixa quando marcadas como pagas em «Contas a pagar» (como qualquer despesa). Gerar a conta não mexe no caixa.
- A previsão soma, por mês de referência, o líquido dos recibos pendentes e os encargos ainda por pagar.

## Valores de referência: confirme com o contabilista
- **Prazos:** INSS até ao dia 10 do mês seguinte e IRT até ao último dia do mês seguinte (`INSS_DUE_DAY` e `IRT_DUE_AT_MONTH_END`
  em `payrollCashFlow.ts`). São valores de gestão, não aconselhamento fiscal.
- **Tabela de IRT e taxas de INSS:** continuam editáveis em Configurações e precisam de manutenção quando a lei mudar. O código não as actualiza sozinho.
- **Contabilidade:** a despesa «Encargos da folha» entra nos lançamentos automáticos como despesa geral (conta 75.2). A separação
  contabilística em contas próprias de INSS/IRT a pagar não foi feita; o contabilista deve ajustá-la no balancete.

## Testes
`tests/payrollCashFlow.test.ts` (prazos, soma por mês, cancelados, idempotência, pagos intocáveis, previsão, fluxo mensal).
