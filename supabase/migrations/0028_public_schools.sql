-- 0028 — Página principal pública: carrossel das escolas registadas na plataforma (SEM login).
-- Devolve só os campos de apresentação: nome, administrador, logótipo, província e NIF.
-- Apenas escolas ativas; logótipo só https ou imagem pequena em base64 (como em my_group_overview).
create or replace function public.public_schools() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.o order by x.nm), '[]'::jsonb)
  from (
    select i.name as nm,
      jsonb_build_object(
        'id', i.id,
        'name', i.name,
        'nif', nullif(btrim(coalesce(i.nif, '')), ''),
        'admin', (select p.name from public.profiles p
                  where p.institution_id = i.id and p.role = 'admin' and p.active
                  order by p.created_at limit 1),
        'province', nullif(btrim(coalesce(d.data ->> 'province', '')), ''),
        'logoUrl', case when length(d.data ->> 'logoUrl') <= 300000
                         and (d.data ->> 'logoUrl') ~* '^(https://|data:image/(png|jpeg|webp);base64,)'
                    then d.data ->> 'logoUrl' end
      ) as o
    from public.institutions i
    left join public.institution_docs d on d.institution_id = i.id and d.key = 'settings'
    where i.status = 'active'
  ) x;
$$;
revoke all on function public.public_schools() from public;
grant execute on function public.public_schools() to anon, authenticated;
