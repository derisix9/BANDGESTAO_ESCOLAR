import { describe, expect, it } from 'vitest';
import { buildGatewayMessages, foldResultsByRecipient, isGatewayConfigured, sendViaGateway, smsSegments, toE164 } from '../src/utils/notificationGateway';
import { isLikelyVapidKey, safeInternalPath, selectFresh, toNotificationOptions } from '../src/utils/pushNotifications';
import { formatMoney, tr } from '../src/i18n';
import { buildExtraProjection } from '../src/utils/userProjections';

describe('telefones', () => {
  it('normaliza para E.164', () => {
    expect(toE164('923 456 789')).toBe('+244923456789');
    expect(toE164('+351 912 345 678')).toBe('+351912345678');
    expect(toE164('00244923456789')).toBe('+244923456789');
    expect(toE164('12345')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});

describe('segmentos de SMS', () => {
  it('GSM-7: 160/153; acentos fora do GSM passam a UCS-2', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ segments: 1, encoding: 'GSM-7' });
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('Reunião amanhã').encoding).toBe('UCS-2');
    expect(smsSegments('')).toEqual({ segments: 0, encoding: 'GSM-7' });
  });
});

describe('mensagens para o gateway', () => {
  it('separa inválidos e duplica por canal quando é "ambos"', () => {
    const r = buildGatewayMessages([{ id: 'a', phone: '923456789' }, { id: 'b', phone: '12' }], 'ambos', 'olá');
    expect(r.invalid).toEqual(['b']);
    expect(r.messages.map((m) => m.id)).toEqual(['a#sms', 'a#whatsapp']);
  });
  it('só considera entregue se todos os canais foram aceites', () => {
    const f = foldResultsByRecipient([{ id: 'a#sms', ok: true }, { id: 'a#whatsapp', ok: false, error: 'recusado' }, { id: 'b', ok: true }]);
    expect(f.get('a')).toEqual({ ok: false, error: 'recusado' });
    expect(f.get('b')?.ok).toBe(true);
  });
});

describe('gateway', () => {
  it('exige https (ou localhost)', () => {
    expect(isGatewayConfigured({ url: 'https://notify.escola.ao/notify' })).toBe(true);
    expect(isGatewayConfigured({ url: 'http://localhost:8787/notify' })).toBe(true);
    expect(isGatewayConfigured({ url: 'http://escola.ao/notify' })).toBe(false);
    expect(isGatewayConfigured({})).toBe(false);
  });
  const msgs = [{ id: 'a', to: '+244923456789', channel: 'sms' as const, body: 'x' }];
  it('sem configuração não chama a rede', async () => {
    let called = false;
    const r = await sendViaGateway({}, 't', msgs, (async () => { called = true; return new Response(); }) as any);
    expect(called).toBe(false);
    expect(r[0].ok).toBe(false);
  });
  it('envia o token e casa os resultados; trata erro HTTP e rede', async () => {
    let auth = '';
    const ok = await sendViaGateway({ url: 'https://g.ao/n' }, 'TOK', msgs, (async (_u: any, init: any) => {
      auth = init.headers.Authorization;
      return new Response(JSON.stringify({ results: [{ id: 'a', ok: true, providerId: 'SM1' }] }), { status: 200 });
    }) as any);
    expect(auth).toBe('Bearer TOK');
    expect(ok[0]).toEqual({ id: 'a', ok: true, providerId: 'SM1' });
    const http = await sendViaGateway({ url: 'https://g.ao/n' }, 'T', msgs, (async () => new Response('não', { status: 403 })) as any);
    expect(http[0].ok).toBe(false);
    const net = await sendViaGateway({ url: 'https://g.ao/n' }, 'T', msgs, (async () => { throw new Error('offline'); }) as any);
    expect(net[0].error).toContain('offline');
  });
});

describe('push', () => {
  it('só caminhos internos', () => {
    expect(safeInternalPath('/propinas')).toBe('/propinas');
    expect(safeInternalPath('//evil.com')).toBe('/');
    expect(safeInternalPath('https://evil.com')).toBe('/');
    expect(safeInternalPath(undefined)).toBe('/');
  });
  it('corta texto longo e mostra só o que ainda não foi visto', () => {
    const { options } = toNotificationOptions({ id: '1', title: 't', message: 'x'.repeat(300), priority: 'urgente' });
    expect((options.body || '').length).toBe(138);
    expect(options.requireInteraction).toBe(true);
    const fresh = selectFresh([{ id: 'a', read: false }, { id: 'b', read: true }, { id: 'c', read: false }], new Set(['c']));
    expect(fresh.map((x) => x.id)).toEqual(['a']);
  });
});

describe('internacionalização', () => {
  it('traduz e cai no português quando falta', () => {
    expect(tr('Notas do Educando', 'en')).toBe("Child's Grades");
    expect(tr('Finanças', 'en')).toBe('Finances');
    expect(tr('Texto sem tradução', 'en')).toBe('Texto sem tradução');
    expect(tr('Olá {nome}', 'pt', { nome: 'Ana' })).toBe('Olá Ana');
  });
  it('formata moeda', () => {
    expect(formatMoney(1500, 'pt')).toContain('1');
  });
});

describe('projeção do encarregado/aluno', () => {
  const db: any = {
    assignments: [
      { id: 'a1', classId: 'c1', status: 'publicado' },
      { id: 'a2', classId: 'c1', status: 'rascunho' },
      { id: 'a3', classId: 'c9', status: 'publicado' }
    ],
    assignmentSubmissions: [
      { id: 'e1', assignmentId: 'a1', studentId: 's1' },
      { id: 'e2', assignmentId: 'a1', studentId: 's2' }
    ],
    teachingMaterials: [
      { id: 'm1', classId: 'c1', visibleToStudents: true },
      { id: 'm2', classId: 'c1', visibleToStudents: false }
    ],
    descriptiveAssessments: [
      { id: 'd1', studentId: 's1', status: 'publicado' },
      { id: 'd2', studentId: 's1', status: 'rascunho' },
      { id: 'd3', studentId: 's2', status: 'publicado' }
    ],
    parentTeacherMeetings: [
      { id: 'r1', type: 'individual', status: 'agendada', participants: [{ studentId: 's1' }, { studentId: 's2' }] },
      { id: 'r2', type: 'coletiva', classId: 'c1', status: 'agendada', participants: [{ studentId: 's1' }, { studentId: 's2' }, { studentId: 's3' }] },
      { id: 'r3', type: 'coletiva', classId: 'c9', status: 'agendada', participants: [{ studentId: 's9' }] },
      { id: 'r4', type: 'individual', status: 'cancelada', participants: [{ studentId: 's1' }] }
    ]
  };
  const p = buildExtraProjection(db, new Set(['c1']), new Set(['s1']));
  it('não vaza rascunhos, outras turmas nem dados de outros alunos', () => {
    expect(p.assignments.map((a: any) => a.id)).toEqual(['a1']);
    expect(p.assignmentSubmissions.map((a: any) => a.id)).toEqual(['e1']);
    expect(p.teachingMaterials.map((a: any) => a.id)).toEqual(['m1']);
    expect(p.descriptiveAssessments.map((a: any) => a.id)).toEqual(['d1']);
  });
  it('reuniões: só as do educando/turma, canceladas fora, participantes dos outros escondidos', () => {
    expect(p.parentTeacherMeetings.map((m: any) => m.id)).toEqual(['r1', 'r2']);
    for (const m of p.parentTeacherMeetings as any[]) expect(m.participants.map((x: any) => x.studentId)).toEqual(['s1']);
  });
});

describe('chave VAPID', () => {
  it('aceita base64url com ~87 caracteres e recusa o resto', () => {
    expect(isLikelyVapidKey('B' + 'a1_-'.repeat(21) + 'xyz')).toBe(true);
    expect(isLikelyVapidKey('')).toBe(false);
    expect(isLikelyVapidKey('curta')).toBe(false);
    expect(isLikelyVapidKey('a b'.repeat(40))).toBe(false);
  });
});
