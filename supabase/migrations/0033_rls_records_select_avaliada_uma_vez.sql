-- A política de leitura chamava app.can_access(collection,'read') POR LINHA (consultas de 1000 linhas = 1000 chamadas,
-- cada uma com joins a profiles/collection_acl/user_access). Agora a lista de colecções permitidas calcula-se UMA vez
-- por consulta (subconsulta não correlacionada) e cada linha só verifica se a sua colecção está nessa lista.
-- Equivalência confirmada antes de aplicar: 0 diferenças de visibilidade para admin, professor, funcionário, aluno e encarregado.
-- Só a leitura muda; INSERT/UPDATE/DELETE ficam exactamente como estavam.
alter policy rec_select on public.records
  using (
    institution_id = (select app.current_institution())
    and collection in (select c.collection from public.collection_acl c where app.can_access(c.collection, 'read'::text))
  );
