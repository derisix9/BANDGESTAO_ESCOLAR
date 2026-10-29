// Descarga PÚBLICA (sem login) da agenda/acta em PDF de uma reunião — é este endereço que vai no SMS e no WhatsApp.
//   GET /functions/v1/meeting-file?i=<escola>&m=<reunião>&t=<código>
// Segurança: o código `t` é aleatório (128 bits), criado quando o PDF é anexado e gravado no registo da reunião
// (records.data.agendaFile.token). Só serve o ficheiro se escola + reunião + código baterem certo; eliminar a reunião
// (ou trocar o PDF) invalida o link. Lê com a chave service_role, mas só devolve esse único ficheiro, sempre como PDF.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { safeEqual } from '../school-backups/secrets.ts';

const BUCKET = 'school-files';
const COLLECTION = 'parentTeacherMeetings';
const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Método não permitido');
  const u = new URL(req.url);
  const inst = u.searchParams.get('i') ?? '', id = u.searchParams.get('m') ?? '', token = u.searchParams.get('t') ?? '';
  if (!inst || !id || !/^[0-9a-f]{20,64}$/i.test(token) || inst.length > 80 || id.length > 120) return text(400, 'Link inválido.');

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  const { data, error } = await admin.from('records').select('data').eq('institution_id', inst).eq('collection', COLLECTION).eq('id', id).maybeSingle();
  const file = (data as any)?.data?.agendaFile;
  if (error || !file || !safeEqual(file.token, token) || typeof file.path !== 'string' || !file.path.startsWith(`${inst}/${COLLECTION}/`)) {
    return text(404, 'Este documento já não está disponível.');
  }
  const dl = await admin.storage.from(BUCKET).download(file.path);
  if (dl.error || !dl.data) return text(404, 'Este documento já não está disponível.');

  const name = String(file.name || 'agenda-reuniao.pdf').replace(/[^\w .()-]+/g, '_').slice(0, 120);
  return new Response(req.method === 'HEAD' ? null : dl.data, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    }
  });
});
