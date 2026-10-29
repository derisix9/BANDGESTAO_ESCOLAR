-- 0019 — Recupera registos "desaparecidos": colecções anuais (faturas, matrículas, planos…) gravadas SEM ano lectivo
-- ficavam com academic_year = NULL e o filtro por ano escondia-os no refresh (≈30 s depois de criados).
-- O cliente já passa a carimbar o ano; esta migração corrige o que ficou para trás.
-- Os dados NÃO foram apagados: só estavam fora do filtro.
--
-- Ajuste o ano abaixo se a sua escola não estiver em 2026/2027.
do $$
declare
  v_year text := '2026/2027';
begin
  -- 1) academic_year em falta, mas o JSON já tem o ano
  update public.records r
     set academic_year = r.data ->> 'academicYear'
   where r.academic_year is null
     and r.data ->> 'academicYear' is not null
     and r.collection in (select collection from public.collection_acl where academic_year_scoped);

  -- 2) sem ano em lado nenhum: assume o ano lectivo actual (coluna + campo no JSON)
  update public.records r
     set academic_year = v_year,
         data = jsonb_set(r.data, '{academicYear}', to_jsonb(v_year), true)
   where r.academic_year is null
     and r.collection in (select collection from public.collection_acl where academic_year_scoped);
end $$;
