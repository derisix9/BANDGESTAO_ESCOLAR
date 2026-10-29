# Pagamentos automáticos por referência Multicaixa

O encarregado paga a propina no **ATM**, no **Multicaixa Express** ou no **homebanking**, com uma referência única por factura,
e a factura fica **paga sozinha** (recibo, pagamento no razão, auditoria e situação financeira do aluno).
Cada escola liga o **seu** fornecedor (hoje: **ProxyPay**) em *Configurações → Integrações → Pagamentos por referência*.
A chave de API fica **cifrada no servidor** (AES-256-GCM, chave fora da base de dados) e nunca volta ao navegador.

## Como funciona
1. Secretaria ou encarregado carrega em **Gerar referência** / **Pagar por referência** (Tesouraria → Propinas, ou portal do aluno/encarregado).
2. A Edge Function `payments` reserva a referência na base de dados (o valor é calculado no servidor: total − já pago), pede-a ao fornecedor e grava
   `multicaixaEntity`, `multicaixaRef`, `multicaixaExpires` e `multicaixaAmountKz` na factura. No máximo **uma** referência activa por factura.
3. O encarregado paga. O fornecedor avisa `payments-webhook` (assinatura HMAC-SHA256 com a chave da escola) e `payment_apply_event()` paga a factura
   numa só transacção. O mesmo aviso repetido não paga duas vezes (`payment_events` + `payments.idempotency_key`).
4. **Rede de segurança:** o agendador consulta o fornecedor de 5 em 5 minutos e apanha avisos perdidos. Referências vencidas passam a *expirada*.

Resultados de cada aviso (visíveis ao administrador): `aplicado`, `valor_diferente` (entrou dinheiro, a secretaria revê), `ja_paga`
(possível duplicado, rever/reembolsar), `sem_referencia` (referência desconhecida), `erro` (o fornecedor repete).

## Instalação
1. Aplicar `supabase/migrations/0038_pagamentos_referencia.sql` (`supabase db push`).
2. Publicar as funções: `supabase functions deploy payments` e `supabase functions deploy payments-webhook`.
3. Segredos: `supabase secrets set PAYMENTS_SECRETS_KEY=<≥32 caracteres> PAYMENTS_CRON_SECRET=<≥24 caracteres>`
   (se faltarem, usa `BACKUP_SECRETS_KEY` / `BACKUP_CRON_SECRET`). **Não troque `PAYMENTS_SECRETS_KEY` depois**: as chaves guardadas deixam de abrir.
4. **Agendador (obrigatório para a rede de segurança):** GitHub Actions `.github/workflows/pagamentos-escolas.yml`
   (secrets `SUPABASE_PROJECT_URL`, `PAYMENTS_CRON_SECRET`) **ou** pg_cron:
   ```sql
   select vault.create_secret('O-MESMO-VALOR-DE-PAYMENTS_CRON_SECRET', 'bm_payments_cron_secret');
   select cron.schedule('bm_payments', '*/5 * * * *', $$
     select net.http_post(url := 'https://<projeto>.supabase.co/functions/v1/payments',
       headers := jsonb_build_object('Content-Type','application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bm_payments_cron_secret')),
       body := '{}'::jsonb) $$);
   ```
5. O Super Admin tem de pôr *Integrações* em modo **gravação** para a escola (migração 0023).
6. A escola pede conta à ProxyPay, cola a **chave de API** e a **entidade**, e começa em **TESTES (sandbox)**: gera uma referência e usa
   **Simular pagamento** para ver a factura ficar paga. Só depois muda para produção (com a chave de produção).

## Segurança
- A escola vem sempre do perfil verificado, nunca do pedido. Aluno/encarregado só geram referência das **suas** facturas.
- Só `service_role` executa as funções SQL de pagamento; o estado "pago" só muda com `app.rpc = 'payment'`.
- Mudar de ambiente, entidade ou fornecedor cancela as referências activas (deixam de servir).
- Um aviso forjado para outra escola não passa: a assinatura é validada com a chave **dessa** escola.

## Limites conhecidos
- Só ProxyPay. Outro fornecedor é uma classe nova com a interface `PaymentProviderClient` em `_shared/pay.ts` (`makeClient`).
- Não há pagamento por cartão dentro do portal: o encarregado vê a referência no portal e paga no Multicaixa Express/ATM/banco.
- O endereço de aviso vai em cada referência (`callback_url`). Confirme com a ProxyPay que a conta o respeita; se não, defina no painel deles
  o webhook `https://<projeto>.supabase.co/functions/v1/payments-webhook?school=<id da escola>`. Em qualquer caso o agendador cobre a falha.

## Testes
`npx vitest run tests/paymentGateway.test.ts` e `bash scripts/test-db.sh` (inclui `supabase/tests/payments_gateway.test.sql`).
