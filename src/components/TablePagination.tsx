import React from 'react';
import { TABLE_PAGE_SIZE, CHEVRON_LEFT, CHEVRON_RIGHT } from '../utils/tablePagination';

/**
 * Paginação "1 - 25 de N registos" com botões ‹ e › — mesmo aspeto e comportamento da paginação
 * global (src/utils/tablePagination.ts), mas feita no React: só as linhas da página
 * chegam a ser desenhadas, o que alivia ecrãs com milhares de registos (ex.: Propinas).
 *
 * Uso:
 *   const { page, setPage, pageItems } = usePagedList(filtered, [search, status]);
 *   ... <tbody>{pageItems.map(...)}</tbody> ...
 *   <TablePagination total={filtered.length} page={page} onPageChange={setPage} />
 */
export function usePagedList<T>(items: T[], resetDeps: React.DependencyList = [], pageSize: number = TABLE_PAGE_SIZE) {
  const [page, setPage] = React.useState(1);
  // Nova pesquisa/filtro → volta à primeira página.
  React.useEffect(() => { setPage(1); }, resetDeps); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages);
  const pageItems = React.useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );
  return { page: safePage, setPage, pages, pageItems, pageSize };
}

export const TablePagination: React.FC<{
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
}> = ({ total, page, onPageChange, pageSize = TABLE_PAGE_SIZE }) => {
  if (total <= pageSize) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  return (
    <div className="gr-pager" role="navigation" aria-label="Paginação da tabela">
      <span className="gr-pager__info">
        <strong>{from} - {to}</strong> <span>de</span> <strong>{total}</strong> registos
      </span>
      <div className="gr-pager__ctrl">
        <button
          type="button"
          className="gr-pager__btn"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          title="Registos anteriores"
          aria-label="Registos anteriores"
        >
          <span dangerouslySetInnerHTML={{ __html: CHEVRON_LEFT }} />
        </button>
        <span className="gr-pager__page" title={`Página ${current} de ${pages}`}>{current}</span>
        <button
          type="button"
          className="gr-pager__btn"
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
          title="Registos seguintes"
          aria-label="Registos seguintes"
        >
          <span dangerouslySetInnerHTML={{ __html: CHEVRON_RIGHT }} />
        </button>
      </div>
    </div>
  );
};
