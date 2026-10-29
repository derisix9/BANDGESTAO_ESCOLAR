import { describe, it, expect } from 'vitest';
import { buildMeetingAttendanceHtml, signatureName } from '../src/utils/meetingAttendanceSheet';
import type { ParentTeacherMeeting } from '../src/types';

const meeting = (over: Partial<ParentTeacherMeeting> = {}): ParentTeacherMeeting => ({
  id: 'r1', code: 'REU-0001', type: 'coletiva' as any, title: 'Balanço do 1.º trimestre', teacherId: 't1', teacherName: 'Ana <Prof>',
  className: '7.ª A', date: '2026-11-05', startTime: '15:00', endTime: '16:30', location: 'Sala 3', status: 'agendada',
  participants: [
    { studentId: 's1', studentName: 'João Silva', guardianName: 'Maria Silva', guardianPhone: '923000111', status: 'convocado' as any },
    { studentId: 's2', studentName: 'Rui "Z"', guardianName: '', guardianPhone: '', status: 'convocado' as any }
  ],
  createdBy: 'x', createdAt: '2026-10-01', ...over
} as ParentTeacherMeeting);

describe('lista de presença da reunião', () => {
  it('tem uma linha com espaço de assinatura por convocado', () => {
    const h = buildMeetingAttendanceHtml(meeting(), { schoolName: 'Escola X' });
    expect(h.match(/class="sig"/g)?.length).toBe(2);
    expect(h).toContain('Maria Silva');
    expect(h).toContain('Escola X');
    expect(h).toContain('REU-0001');
  });
  it('escapa HTML', () => {
    const h = buildMeetingAttendanceHtml(meeting());
    expect(h).toContain('Ana &lt;Prof&gt;');
    expect(h).toContain('Rui &quot;Z&quot;');
  });
  it('sem convocados mostra aviso', () => {
    expect(buildMeetingAttendanceHtml(meeting({ participants: [] }))).toContain('Sem encarregados convocados');
  });
  it('reunião agendada: sem coluna Situação e sem assinaturas automáticas', () => {
    const h = buildMeetingAttendanceHtml(meeting());
    expect(h).not.toContain('<th>Situação</th>');
    expect(h).not.toContain('class="hand"');
  });
  it('reunião realizada: coluna Situação e assinatura manuscrita só de quem esteve presente', () => {
    const h = buildMeetingAttendanceHtml(meeting({
      status: 'realizada' as any,
      participants: [
        { studentId: 's1', studentName: 'João', guardianName: 'Maria Silva', guardianPhone: '', status: 'compareceu' as any },
        { studentId: 's2', studentName: 'Rui', guardianName: 'Pai Rui', guardianPhone: '', status: 'faltou' as any },
        { studentId: 's3', studentName: 'Eva', guardianName: 'Mãe Eva', guardianPhone: '', status: 'convocado' as any }
      ]
    }));
    expect(h).toContain('<th>Situação</th>');
    expect(h).toContain('Esteve presente');
    expect(h).toContain('Faltou');
    expect(h).toContain('Sem registo de presença');
    expect(h.match(/<span class="hand">/g)?.length).toBe(1);
    expect(h).toContain('<span class="hand">Maria Silva</span>');
  });
  it('assinatura: primeiro e último nome, sem inclinação', () => {
    expect(signatureName('MARIA ANA SILVA')).toBe('Maria Silva');
    expect(signatureName('rui pedro')).toBe('Rui Pedro');
    const h = buildMeetingAttendanceHtml(meeting({ status: 'realizada' as any, participants: [{ studentId: 's', studentName: 'x', guardianName: 'ANA MARIA GASPAR', guardianPhone: '', status: 'compareceu' as any }] }));
    expect(h).toContain('<span class="hand">Ana Gaspar</span>');
    expect(h).not.toContain('rotate');
  });
  it('logótipo aparece quando indicado', () => {
    expect(buildMeetingAttendanceHtml(meeting(), { logoUrl: 'data:image/png;base64,AAA' })).toContain('<img class="logo" src="data:image/png;base64,AAA"');
    expect(buildMeetingAttendanceHtml(meeting())).not.toContain('<img');
  });
});
