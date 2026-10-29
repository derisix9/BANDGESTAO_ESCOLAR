-- Índices GIN nunca usados (advisor "unused_index") que encareciam CADA gravação em records
-- (matrículas/pagamentos em lote). A pesquisa por nome usa ilike sobre data->>'name', que records_name_trgm
-- (expressão lower(...)) nunca serviu; records_data_gin nunca foi consultado.
-- Reversível: basta recriar com CREATE INDEX se algum dia for necessário.
drop index if exists public.records_data_gin;
drop index if exists public.records_name_trgm;
