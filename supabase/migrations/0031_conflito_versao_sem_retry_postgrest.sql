-- O PostgREST repete automaticamente transacções que falham com SQLSTATE 40001 (serialization_failure).
-- O conflito de versão (bloqueio optimista) é um erro "definitivo": repeti-lo com a mesma versão nunca resolve e
-- gerava centenas de milhares de tentativas por hora (CPU/locks, 504 e "servidor indisponível").
-- Passa a devolver PT409 (HTTP 409 Conflict) — o cliente relê a versão e reaplica a alteração.
-- Idempotente: reescreve a função actual (qualquer versão) só se ainda usar 40001.
do $$
declare d text;
begin
  d := pg_get_functiondef('app.guard_record_write'::regproc);
  if position('errcode = ''40001''' in d) = 0 then
    raise notice 'guard_record_write já não usa 40001; nada a fazer';
    return;
  end if;
  d := replace(d, 'errcode = ''40001''', 'errcode = ''PT409''');
  execute d;
end $$;
