-- Move contas que foram criadas na escola MÃE quando deviam estar numa FILIAL.
-- Executar no SQL Editor do Supabase (sem sessão de utilizador, o gatilho profiles_guard permite a alteração).
-- Passo 1: veja as escolas e as contas; Passo 2: indique e-mails e filial; Passo 3: confirme.

-- 1) Escolas do grupo e quantos perfis cada uma tem
select i.id, i.name, i.parent_id, (select count(*) from public.profiles p where p.institution_id = i.id) as perfis
from public.institutions i order by coalesce(i.parent_id, i.id), i.parent_id nulls first;

-- 2) Contas atualmente na mãe (veja quais pertencem à filial)
-- select id, email, name, role, institution_id from public.profiles where institution_id = '<ID_DA_MAE>' order by created_at desc;

-- 3) Mover (edite os dois valores abaixo e execute o bloco todo)
do $$
declare
  v_emails text[] := array['email1@exemplo.com', 'email2@exemplo.com'];  -- << contas a mover
  v_filial text   := 'ID_DA_FILIAL';                                       -- << id da filial de destino
  v_mae    text;
  n int;
begin
  select parent_id into v_mae from public.institutions where id = v_filial;
  if v_mae is null then raise exception 'A escola % não existe ou não é uma filial.', v_filial; end if;

  -- só move contas que estão hoje na mãe desta filial e que não são administradores
  create temp table _mv on commit drop as
    select id from public.profiles
    where lower(email) = any (select lower(x) from unnest(v_emails) x)
      and institution_id = v_mae and role <> 'admin';
  select count(*) into n from _mv;

  update public.profiles       set institution_id = v_filial where id in (select id from _mv);
  delete from public.user_access      a where a.institution_id = v_mae and a.user_id in (select id from _mv)
    and exists (select 1 from public.user_access b where b.institution_id = v_filial and b.user_id = a.user_id);
  update public.user_access       set institution_id = v_filial where institution_id = v_mae and user_id in (select id from _mv);
  delete from public.user_projections a where a.institution_id = v_mae and a.user_id in (select id from _mv)
    and exists (select 1 from public.user_projections b where b.institution_id = v_filial and b.user_id = a.user_id);
  update public.user_projections  set institution_id = v_filial where institution_id = v_mae and user_id in (select id from _mv);

  raise notice '% conta(s) movida(s) para %', n, v_filial;
end $$;
