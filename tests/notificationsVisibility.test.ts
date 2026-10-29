import { beforeEach, describe, expect, it } from 'vitest';
import { dbService } from '../src/services/db';

const D: any = dbService;
const as = (role: string, id: string, extra: any = {}) => { D.db.currentUser = { id, name: id, role, ...extra }; };

function seed() {
  const db = D.db;
  db.students = [{ id: 's1', name: 'Aluno Um' }, { id: 's2', name: 'Aluno Dois' }];
  db.invoices = [];
  db.events = [];
  db.notifications = [];
  db.currentUser = { id: 'admin1', name: 'Admin', role: 'admin' };
  try { localStorage.clear(); } catch { /* */ }
}

describe('notificações: quem vê o quê', () => {
  beforeEach(seed);

  it('aluno/encarregado/professor só veem o geral e o que é pessoal', () => {
    dbService.addNotification({ type: 'notice', id: 'a', title: 'Aviso', message: '.', general: true, targetRoles: ['aluno', 'professor', 'admin'] });
    dbService.addNotification({ type: 'notice', id: 'b', title: 'Interno', message: '.', targetRoles: ['admin', 'director', 'secretaria'] });
    dbService.addNotification({ type: 'notice', id: 'c', title: 'Sem perfil', message: '.' }); // antes: aparecia a todos
    dbService.addNotification({ type: 'notice', id: 'd', title: 'Pessoal prof', message: '.', targetRoles: ['professor'], targetUserId: 'p1' });
    expect(dbService.getNotifications('aluno', 'x').map((n) => n.id)).toEqual(['a']);
    expect(dbService.getNotifications('professor', 'p1').map((n) => n.id).sort()).toEqual(['a', 'd']);
    expect(dbService.getNotifications('professor', 'p2').map((n) => n.id)).toEqual(['a']);
    expect(dbService.getNotifications('admin', 'admin1').map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('notas lançadas: 1 notificação por turma+disciplina, só dos alunos afetados; relançar não acumula', () => {
    D.db.classes = [{ id: 'c1', name: '7.ª A' }];
    D.db.subjects = [{ id: 'mat', name: 'Matemática' }];
    D.db.settings = { ...(D.db.settings || {}), currentAcademicYear: '2026/2027' };
    const rows = [{ studentId: 's1', mac1: 12, npp1: 12, npt1: 12 }];
    dbService.saveMiniPautaRows('c1', 'mat', rows, 'Prof');
    dbService.saveMiniPautaRows('c1', 'mat', [{ studentId: 's1', mac1: 15, npp1: 15, npt1: 15 }], 'Prof');
    const grades = D.db.notifications.filter((n: any) => n.id === 'notif-nota-c1-mat');
    expect(grades.length).toBe(1);
    expect(grades[0].targetStudentIds).toEqual(['s1']);
    as('aluno', 'u1', { linkedStudentId: 's1' });
    D.db.students = [{ id: 's1', name: 'Aluno Um' }];
    expect(dbService.getNotifications('aluno', 'u1').some((n) => n.id === 'notif-nota-c1-mat')).toBe(true);
    D.db.students = [{ id: 's2', name: 'Aluno Dois' }];
    as('aluno', 'u2', { linkedStudentId: 's2' });
    expect(dbService.getNotifications('aluno', 'u2').some((n) => n.id === 'notif-nota-c1-mat')).toBe(false);
  });

  it('fatura em mora/pendente só para o educando; lembrete de evento de amanhã para todos', () => {
    const t = new Date(); t.setDate(t.getDate() + 1);
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    D.db.events = [{ id: 'e1', title: 'Exame', date: iso, category: 'exame', description: '' }];
    D.db.invoices = [{ id: 'i1', studentId: 's1', studentName: 'Aluno Um', status: 'atraso', period: 'Março', totalAmountKz: 1000, dueDate: '2026-03-10', daysLate: 5 }];
    D.db.students = [{ id: 's1', name: 'Aluno Um' }];
    as('encarregado', 'g1');
    const ids = dbService.getNotifications('encarregado', 'g1').map((n) => n.id);
    expect(ids).toContain('v-mora-i1');
    expect(ids).toContain(`v-evt-e1-${iso}`);
    D.db.invoices = [{ ...D.db.invoices[0], studentId: 'outro' }];
    expect(dbService.getNotifications('encarregado', 'g1').map((n) => n.id)).not.toContain('v-mora-i1');
    expect(dbService.getNotifications('professor', 'p1').map((n) => n.id)).toEqual([`v-evt-e1-${iso}`]);
  });

  it('ler/apagar como aluno é local: não altera o documento partilhado', () => {
    dbService.addNotification({ type: 'notice', id: 'a', title: 'Aviso', message: '.', general: true });
    const before = JSON.stringify(D.db.notifications);
    as('aluno', 'u1');
    dbService.markNotificationAsRead('a');
    expect(dbService.getNotifications('aluno', 'u1')[0].read).toBe(true);
    dbService.clearAllNotifications();
    expect(dbService.getNotifications('aluno', 'u1')).toEqual([]);
    expect(JSON.stringify(D.db.notifications)).toBe(before);
    as('admin', 'admin1');
    expect(dbService.getNotifications('admin', 'admin1').length).toBe(1);
  });
});
