import { describe, it, expect } from 'vitest';
import type { ParentTeacherMeeting } from '../src/types';
import { buildMeetingNoticeText, meetingFileLink, meetingNoticeRecipients, MEETING_NOTICE_MAX } from '../src/utils/meetingNotice';
import { buildGatewayMessages } from '../src/utils/notificationGateway';
import { MetaWhatsApp, TwilioWhatsApp, cleanWhatsAppSetup } from '../supabase/functions/_shared/notify';
import { deliverJob, type DeliverJob } from '../supabase/functions/_shared/notifyDeliver';

const meeting = (over: Partial<ParentTeacherMeeting> = {}): ParentTeacherMeeting => ({
  id: 'reu-1', code: 'REU-0001', type: 'individual', title: 'Ponto de situação do trimestre', teacherId: 't1', teacherName: 'Prof. A',
  date: '2026-11-05', startTime: '15:00', endTime: '16:00', location: 'Sala 3', status: 'agendada', createdBy: 'x', createdAt: '2026-10-01',
  participants: [
    { studentId: 's1', studentName: 'Ana', guardianName: 'Maria', guardianPhone: '923 456 789', status: 'convocado' },
    { studentId: 's2', studentName: 'Bruno', guardianName: 'Maria', guardianPhone: '+244923456789', status: 'convocado' },
    { studentId: 's3', studentName: 'Carla', guardianName: 'José', guardianPhone: '', status: 'convocado' }
  ],
  ...over
});
const URL_ = 'https://abc.supabase.co';
const withFile = meeting({ agendaFile: { name: 'agenda.pdf', size: 1000, path: 'i/parentTeacherMeetings/reu-1/a.pdf', token: 'a'.repeat(32), uploadedAt: '' } });
const TW = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'b'.repeat(32) };
const rec = (status = 201, body: unknown = {}) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return { calls, fn: async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); } };
};

describe('convocatória de reunião', () => {
  it('um destinatário por telefone e lista de quem não tem telefone', () => {
    const { recipients, withoutPhone } = meetingNoticeRecipients(meeting());
    expect(recipients).toHaveLength(1);
    expect(recipients[0].studentNames).toEqual(['Ana', 'Bruno']);
    expect(withoutPhone).toEqual(['Carla']);
  });
  it('link de descarga só existe com PDF e leva escola, reunião e código', () => {
    expect(meetingFileLink(URL_, 'inst1', meeting())).toBeNull();
    const l = meetingFileLink(URL_, 'inst1', withFile)!;
    expect(l.startsWith(`${URL_}/functions/v1/meeting-file?`)).toBe(true);
    expect(l).toContain('i=inst1');
    expect(l).toContain('m=reu-1');
    expect(l).toContain(`t=${'a'.repeat(32)}`);
  });
  it('textos levam os detalhes, respeitam o limite e nunca cortam o link', () => {
    const link = meetingFileLink(URL_, 'inst1', withFile)!;
    const r = { studentNames: ['Ana', 'Bruno'] };
    const wa = buildMeetingNoticeText('whatsapp', withFile, r, { schoolName: 'Colégio X', link });
    expect(wa).toContain('05/11/2026');
    expect(wa).toContain('15:00–16:00');
    expect(wa).toContain('Sala 3');
    expect(wa.endsWith(link)).toBe(true);
    const sms = buildMeetingNoticeText('sms', withFile, r, { schoolName: 'Colégio X', link });
    expect(sms.endsWith(link)).toBe(true);
    const long = meeting({ title: 'T'.repeat(300), location: 'L'.repeat(300), agendaFile: withFile.agendaFile });
    for (const ch of ['sms', 'whatsapp'] as const) {
      const t = buildMeetingNoticeText(ch, long, { studentNames: ['N'.repeat(200)] }, { schoolName: 'E'.repeat(100), link });
      expect(t.length).toBeLessThanOrEqual(MEETING_NOTICE_MAX);
      expect(t.endsWith(link)).toBe(true);
    }
    expect(buildMeetingNoticeText('sms', meeting(), r)).not.toContain('Agenda:');
  });
  it('o anexo só segue no canal WhatsApp', () => {
    const att = { url: 'https://abc.supabase.co/functions/v1/meeting-file?i=1&m=2&t=3', filename: 'a.pdf' };
    const both = buildGatewayMessages([{ id: 'r', phone: '923456789' }], 'ambos', 'x', 'critico', att).messages;
    expect(both.find((m) => m.channel === 'whatsapp')?.attachment).toEqual(att);
    expect(both.find((m) => m.channel === 'sms')?.attachment).toBeUndefined();
  });
});

describe('fornecedores com PDF', () => {
  const att = { url: 'https://abc.supabase.co/functions/v1/meeting-file?i=1&m=2&t=3', filename: 'agenda.pdf' };
  it('Meta: modelo com cabeçalho de documento quando configurado; senão o modelo normal', async () => {
    const cfg = { phoneNumberId: '123456789012', templateName: 'aviso', templateLang: 'pt_PT', apiVersion: 'v21.0' };
    const a = rec(200, { messages: [{ id: 'w1' }] });
    await new MetaWhatsApp({ ...cfg, documentTemplateName: 'reuniao_pdf' }, { accessToken: 't'.repeat(30) }, a.fn).sendTemplate({ id: '1', to: '+244923456789', text: 'Olá', attachment: att });
    const body = JSON.parse(String(a.calls[0].init.body));
    expect(body.template.name).toBe('reuniao_pdf');
    expect(body.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'document', document: { link: att.url, filename: 'agenda.pdf' } }] });
    const b = rec(200, { messages: [{ id: 'w2' }] });
    await new MetaWhatsApp(cfg, { accessToken: 't'.repeat(30) }, b.fn).sendTemplate({ id: '1', to: '+244923456789', text: 'Olá', attachment: att });
    const body2 = JSON.parse(String(b.calls[0].init.body));
    expect(body2.template.name).toBe('aviso');
    expect(body2.template.components).toHaveLength(1);
  });
  it('Twilio: modelo com documento leva {{2}} = endereço; sem ele segue o modelo normal', async () => {
    const sid = 'HX' + 'a'.repeat(32), doc = 'HX' + 'b'.repeat(32);
    const a = rec(201, { sid: 'SM1' });
    await new TwilioWhatsApp({ from: '+14155238886', contentSid: sid, documentContentSid: doc }, TW, a.fn).sendTemplate({ id: '1', to: '+244923456789', text: 'Olá', attachment: att });
    const f = new URLSearchParams(String(a.calls[0].init.body));
    expect(f.get('ContentSid')).toBe(doc);
    expect(JSON.parse(f.get('ContentVariables')!)).toEqual({ 1: 'Olá', 2: att.url });
    const b = rec(201, { sid: 'SM2' });
    await new TwilioWhatsApp({ from: '+14155238886', contentSid: sid }, TW, b.fn).sendTemplate({ id: '1', to: '+244923456789', text: 'Olá', attachment: att });
    expect(new URLSearchParams(String(b.calls[0].init.body)).get('ContentSid')).toBe(sid);
  });
  it('configuração valida o modelo com documento (opcional)', () => {
    const base = { config: { phoneNumberId: '123456789012', templateName: 'aviso', documentTemplateName: 'reuniao_pdf' }, secret: {} };
    expect(cleanWhatsAppSetup('meta_cloud', base).config).toMatchObject({ documentTemplateName: 'reuniao_pdf' });
    expect(() => cleanWhatsAppSetup('meta_cloud', { ...base, config: { ...base.config, documentTemplateName: 'Mau Nome' } })).toThrow(/modelo com documento/);
    expect(() => cleanWhatsAppSetup('twilio', { config: { from: '+14155238886', contentSid: 'HX' + 'a'.repeat(32), documentContentSid: 'xx' }, secret: { accountSid: 'AC' + 'a'.repeat(32), authToken: 'b'.repeat(32) } })).toThrow(/modelo com documento/);
  });
  it('worker por escola passa o anexo ao fornecedor de WhatsApp (e nunca ao de SMS)', async () => {
    const seen: any[] = [];
    const wa = { sendTemplate: async (i: any) => { seen.push(i); return { providerId: 'p' }; }, send: async (i: any) => { seen.push(i); return {}; } };
    const calls: string[] = [];
    const deps: any = {
      rpc: { rpc: async (fn: string) => { calls.push(fn); return { data: null, error: null }; } },
      openSecret: async () => ({ accessToken: 't'.repeat(30) }),
      fetchFn: undefined
    };
    const job = (channel: 'sms' | 'whatsapp'): DeliverJob => ({ id: 'j', institution_id: 'i', channel, to_phone: '+244923456789', body: 'x', category: 'critico', provider: 'meta_cloud',
      config: { phoneNumberId: '123456789012', templateName: 'a', templateLang: 'pt_PT', apiVersion: 'v21.0' }, secret_enc: 'x', critical_only: true,
      attachment_url: att.url, attachment_name: 'agenda.pdf' });
    // fetch simulado para a Meta
    deps.fetchFn = async (_u: string, init: RequestInit) => { seen.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200 }); };
    void wa;
    expect(await deliverJob(job('whatsapp'), deps)).toBe('sent');
    expect(seen[0].template.components[0].type).toBe('body');   // sem modelo com documento: segue o modelo normal com o link no texto
    expect(calls).toContain('finish_notification');
  });
});
