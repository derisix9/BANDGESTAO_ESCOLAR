// meeting-file (ficheiro único para o editor do Supabase — não importa nada local)
// Descarga PÚBLICA (sem login) da agenda/acta em PDF de uma reunião: é este endereço que vai no SMS e no WhatsApp.
//   GET /functions/v1/meeting-file?i=<escola>&m=<reunião>&t=<código>
// Segurança: o código `t` é aleatório (128 bits), criado quando o PDF é anexado e gravado no registo da reunião
// (records.data.agendaFile.token). Só serve o ficheiro se escola + reunião + código baterem certo; eliminar a reunião
// (ou trocar o PDF) invalida o link. Lê com a chave service_role, mas só devolve esse único ficheiro, sempre como PDF.
// No painel: desligue «Verify JWT» nesta função (o link é aberto por pessoas sem sessão).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const BUCKET = 'school-files';
const COLLECTION = 'parentTeacherMeetings';
const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Comparação em tempo constante (evita descobrir o código por diferenças de tempo). */
function safeEqual(a: unknown, b: unknown): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

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
