/** Arquivo dos PDFs emitidos pelo BANDGESTÃO AI. Os links de download são temporários. */
import { createAdminClient, getCallerFromToken } from '../_whatsapp-ai';
import { bearerToken, sameOriginHost } from '../_guard';

const fail = (res: any, status: number, error: string) => res.status(status).json({ ok: false, error });

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return fail(res, 405, 'Método não permitido.');
  if (!sameOriginHost(req.headers || {})) return fail(res, 403, 'Origem não autorizada.');
  const token = bearerToken(req.headers || {});
  if (!token) return fail(res, 401, 'Inicie sessão no BANDGESTÃO.');
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return fail(res, 503, 'Arquivo de documentos indisponível.'); }
  let caller;
  try { caller = await getCallerFromToken(token, admin); }
  catch (error) { return fail(res, 403, error instanceof Error ? error.message : 'Acesso recusado.'); }

  // O arquivo é pessoal nesta versão. Ser admin/director não deve expor
  // documentos de colegas se existir uma restrição personalizada de secção.
  const query = admin.from('whatsapp_ai_documents')
    .select('id,user_id,document_type,title,filename,file_format,created_at,storage_path')
    .eq('institution_id', caller.institutionId).eq('user_id', caller.uid)
    .order('created_at', { ascending: false }).limit(30);
  const { data, error } = await query;
  if (error) return fail(res, 500, 'Não foi possível consultar o arquivo de documentos.');

  const documents = [];
  for (const row of data || []) {
    const { data: signed } = await admin.storage.from('school-files').createSignedUrl(String(row.storage_path), 600);
    documents.push({
      id: row.id, type: row.document_type, title: row.title, filename: row.filename, format: row.file_format === 'xlsx' ? 'xlsx' : 'pdf',
      createdAt: row.created_at, url: signed?.signedUrl || null
    });
  }
  return res.status(200).json({ ok: true, documents });
}
