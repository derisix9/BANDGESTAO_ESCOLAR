/**
 * Montagem do Estúdio: junta a base de dados da escola com o estado do ecrã e devolve tudo o que a
 * vista precisa (listas, modelos, cenas dos cartões, documento de fluxo, número seguinte).
 * Função pura: não escreve na base de dados nem toca no DOM.
 */
import type { SchoolDatabase, Student } from '../types';
import type { AcademicDocType } from '../utils/academicProcesses';
import { formatDocNumber, nextDocSequence } from '../utils/academicProcesses';
import type { CardModel } from './cards';
import { cardPair, getCardModel } from './cards';
import { buildPublicLink, getPublicInstitution, publicBase, publicTokenOf } from '../utils/publicLink';
import {
  MONTHS_PT, SHIFT_LABEL, buildTransportLink, enrollmentOf, isConfirmedRider, isMonthPaid, paidMonths, personKey
} from '../utils/transportPass';
import { feesFor } from './fees';
import type { StaffPerson, StudioData, StudioLevel } from './data';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { buildSchool, buildStudioData, levelOfGrade, listStaff } from './data';
import type { FlowDoc, FlowModel } from './flow';
import { defaultExtras, getFlowModel } from './flow';
import { applyBg } from './bg';
import type { Scene } from './scene';
import { applyRadius } from './scene';
import { hasCurso } from './cards';
import type { StudioState } from './state';
import { overridesOf } from './state';
import {
  buildCardCtx, buildFlowDoc, cardModelsFor, docTypeOfTab, flowModelsFor, isCardTab, isFlowTab, suggestedModelId, yearOptions
} from './session';

/** Valor gravado no QR: conferido contra o registo da escola (número + código de verificação). */
export const verifyValueFor = (number: string, code: string, school: string) => `DOC|${number}|${code}|${school}`;

/** Marcador do QR antes de o documento ser registado (o código só existe depois da emissão). */
export const PENDING_CODE = 'PENDENTE';

export interface StudioView {
  students: Student[];
  staff: StaffPerson[];
  student?: Student;
  data: StudioData | null;
  staffSelected: StaffPerson[];
  level?: StudioLevel;
  years: string[];
  cardModels: CardModel[];
  flowModels: FlowModel[];
  cardModel?: CardModel;
  /** Posição efectiva dos cartões (depois de aplicar a escolha do utilizador). */
  cardOrient?: 'h' | 'v' | 'a4l';
  /** O modelo tem desenho nas duas posições. */
  hasAlt: boolean;
  flowModel?: FlowModel;
  flowDoc?: FlowDoc;
  /** Modo turma (certificados/declarações): um documento por aluno, pronto a exportar num único Word. */
  batchFlowDocs: FlowDoc[];
  /** Modo turma (histórico): os dados académicos de cada aluno da turma. */
  batchData: StudioData[];
  /** Um item por pessoa (cartões/diplomas). */
  cardItems: Array<{ front: Scene; back?: Scene }>;
  photos: Array<string | undefined>;
  /** Alunos da turma escolhida (modo \"Turma inteira\"). */
  batchStudents: Student[];
  isBatch: boolean;
  /** Textos finais a aplicar (modelo + documento). */
  overrides: Record<string, string>;
  /** Tipo do registo oficial; `null` quando o separador não gera registo (crachá de funcionário). */
  docType: AcademicDocType | null;
  /** Número que o sistema dará à próxima emissão deste tipo (pré-visualização). */
  nextNumber: string;
  /** Número/código a mostrar no documento: os oficiais se já emitido, senão os provisórios. */
  number: string;
  code: string;
  verifyValue: string;
  /** O que impede de exportar/emitir, em português; vazio quando está pronto. */
  blockers: string[];
  /** Avisos do modelo (dados em falta que ficam em branco, editáveis no documento). */
  warnings: string[];
}

/** Dados só da escola, para os separadores que não dependem de um aluno (crachá de funcionário). */
export function schoolOnlyData(db: SchoolDatabase): StudioData {
  return {
    school: buildSchool(db),
    person: { id: '', name: '', father: '', mother: '', gender: 'M', birthDateIso: '', birthDate: '', birthDateExt: '', naturalidade: '', municipio: '', provincia: '', bi: '', biIssueDate: '', procNumber: '', photo: '', phone: '' },
    enrollment: { year: db.settings?.currentAcademicYear || '', grade: '', classNum: null, turma: '', numero: '', periodo: '', curso: '', cursoDescricao: '', cursoCodigo: '', matricula: '', sala: '' },
    history: [], rows: [], averageByClass: {}, generatedAt: new Date().toISOString()
  };
}

/** Tipo do registo oficial para o que está no ecrã. */
export function registerTypeOf(tab: StudioState['tab'], withGrades: boolean): AcademicDocType | null {
  return tab === 'funcionario' ? 'cracha_funcionario' : docTypeOfTab(tab, withGrades);
}

export function assembleStudio(db: SchoolDatabase, s: StudioState): StudioView {
  const students = db.students || [];
  const staff = listStaff(db);
  const student = students.find((x) => String(x.id) === s.studentId);
  const currentYear = db.settings?.currentAcademicYear || '';
  const year = s.year || currentYear;

  // Modo "turma inteira": cartões, transporte, diplomas, certificados, declarações e históricos.
  const batch = s.scope === 'turma' && s.tab !== 'funcionario';
  const batchStudents = batch && s.classId ? getStudentsForClass(s.classId, students) : [];
  const data = student ? buildStudioData(db, student, year) : null;
  const level = data ? levelOfGrade(data.enrollment.grade) : undefined;
  const staffSelected = s.staffIds.map((id) => staff.find((p) => p.id === id)).filter((p): p is StaffPerson => !!p);

  const cardModels = cardModelsFor(s.tab, level);
  const flowModels = flowModelsFor(s.tab, level);
  const modelId = s.modelId || suggestedModelId(s.tab, data);
  const cardModel = isCardTab(s.tab) ? (cardModels.find((m) => m.id === modelId) || getCardModel(modelId) || cardModels[0]) : undefined;
  const flowModel = isFlowTab(s.tab) ? (flowModels.find((m) => m.id === modelId) || getFlowModel(modelId) || flowModels[0]) : undefined;

  const docType = registerTypeOf(s.tab, !!flowModel?.withGrades);
  const nextNumber = docType ? formatDocNumber(docType, new Date().getFullYear(), nextDocSequence(db.academicDocuments || [], docType, new Date().getFullYear())) : '';
  const number = s.issued?.number || nextNumber;
  const code = s.issued?.code || PENDING_CODE;
  const schoolName = (data || schoolOnlyData(db)).school.name;
  const verifyValue = verifyValueFor(number, code, schoolName);
  const overrides = overridesOf(s);

  const batchData: StudioData[] = batch ? batchStudents.map((st) => buildStudioData(db, st, year)) : [];

  let flowDoc: FlowDoc | undefined;
  if (flowModel && data) {
    flowDoc = buildFlowDoc({ data, model: flowModel, year, classNum: s.classNum, extras: s.extras || defaultExtras(data), page: s.page });
  }
  // Modo turma (certificado/declaração): um documento por aluno; o primeiro é a pré-visualização.
  const batchFlowDocs: FlowDoc[] = [];
  if (flowModel && batch) {
    for (const d of batchData) {
      batchFlowDocs.push(buildFlowDoc({ data: d, model: flowModel, year, classNum: s.classNum, extras: s.extras || defaultExtras(d), page: s.page }));
    }
    flowDoc = batchFlowDocs[0];
  }

  const cardItems: StudioView['cardItems'] = [];
  const photos: StudioView['photos'] = [];
  const pair = cardModel ? cardPair(cardModel, s.orientation, s.tab === 'estudante' ? s.backSide : 'padrao') : undefined;
  if (cardModel && pair) {
    const base = data || schoolOnlyData(db);
    const ctxInput = { data: base, year, verifyValue, rota: s.rota, registo: s.registo || number, outorga: s.outorga ?? undefined, dataEmissao: s.dataEmissao ?? undefined };
    if (s.tab === 'transporte') {
      // Cartão de transporte: só passageiros com inscrição confirmada; o QR grava o link de
      // embarque (pessoa + rota + turno + ano) que a aplicação do motorista vai ler.
      const linkFor = (key: string) => {
        const route = enrollmentOf(db, key);
        return route ? buildTransportLink(key, route, year, { base: publicBase(), inst: getPublicInstitution(), token: publicTokenOf(key) }) : verifyValue;
      };
      const paidFor = (key: string) => { const r = enrollmentOf(db, key); return r ? [...paidMonths(r, key, year)].sort((x, y) => x - y) : []; };
      const rotaFor = (key: string) => {
        if (s.rota) return s.rota;
        const r = enrollmentOf(db, key);
        return r ? `${r.name} · ${r.code} · ${SHIFT_LABEL[r.shift]}` : '';
      };
      for (const p of staffSelected) {
        if (!isConfirmedRider(db, p.id)) continue; // StaffPerson.id já é a chave ('t:…' / 'f:…')
        const iss = s.batchIssued[p.id];
        const ctx = buildCardCtx('transporte', {
          ...ctxInput, data: schoolOnlyData(db), staff: p,
          verifyValue: linkFor(p.id), rota: rotaFor(p.id), registo: s.registo || iss?.number || nextNumber, transpPaid: paidFor(p.id)
        });
        if (ctx) { cardItems.push({ front: pair.front(ctx), back: pair.back(ctx) }); photos.push(p.photo || undefined); }
      }
      if (batch) {
        for (const st of batchStudents) {
          const key = personKey('student', String(st.id));
          if (!isConfirmedRider(db, key)) continue; // alunos sem inscrição confirmada não saem
          const d = buildStudioData(db, st, year);
          const iss = s.batchIssued[key];
          const num = iss?.number || nextNumber;
          const ctx = buildCardCtx('transporte', { ...ctxInput, data: d, verifyValue: linkFor(key), rota: rotaFor(key), registo: num, transpPaid: paidFor(key) });
          if (ctx) { cardItems.push({ front: pair.front(ctx), back: pair.back(ctx) }); photos.push(d.person.photo || undefined); }
        }
      } else if (data && student) {
        const key = personKey('student', String(student.id));
        if (isConfirmedRider(db, key)) {
          const iss = s.batchIssued[key];
          const ctx = buildCardCtx('transporte', {
            ...ctxInput, verifyValue: linkFor(key), rota: rotaFor(key),
            registo: s.registo || iss?.number || number,
            transpPaid: paidFor(key)
          });
          if (ctx) { cardItems.push({ front: pair.front(ctx), back: pair.back(ctx) }); photos.push(data.person.photo || undefined); }
        }
      }
    } else if (s.tab === 'funcionario') {
      for (const p of staffSelected) {
        const iss = s.batchIssued[p.id];
        const num = iss?.number || nextNumber;
        const ctx = buildCardCtx('funcionario', { ...ctxInput, staff: p, registo: s.registo || num, verifyValue: buildPublicLink('staff', p.id) });
        if (ctx) { cardItems.push({ front: pair.front(ctx), back: pair.back(ctx) }); photos.push(p.photo || undefined); }
      }
    } else if (batch) {
      for (const st of batchStudents) {
        const d = buildStudioData(db, st, year);
        const iss = s.batchIssued[String(st.id)];
        const num = iss?.number || nextNumber;
        const vv = buildPublicLink('student', String(st.id));
        const ctx = buildCardCtx(s.tab, { ...ctxInput, data: d, verifyValue: vv, registo: num, fees: feesFor(db.invoices, String(st.id), year) });
        if (ctx) { cardItems.push({ front: pair.front(ctx), back: pair.back(ctx) }); photos.push(d.person.photo || undefined); }
      }
    } else if (data) {
      const ctx = buildCardCtx(s.tab, { ...ctxInput, verifyValue: buildPublicLink('student', String(student!.id)), fees: feesFor(db.invoices, String(student!.id), year) });
      if (ctx) { cardItems.push({ front: pair.front(ctx), back: pair.back(ctx) }); photos.push(data.person.photo || undefined); }
    }
  }

  // Fundo personalizado (cor, gradiente ou imagem de folha inteira) por cima de qualquer modelo.
  if (s.bg.mode !== 'modelo') {
    for (const it of cardItems) {
      it.front = applyBg(it.front, s.bg, 'front');
      if (it.back) it.back = applyBg(it.back, s.bg, 'back');
    }
  }

  // Arredondamento dos cantos (não se aplica ao diploma A4).
  if (s.radius != null && s.tab !== 'diploma') {
    for (const it of cardItems) {
      it.front = applyRadius(it.front, s.radius);
      if (it.back) it.back = applyRadius(it.back, s.radius);
    }
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (s.tab === 'transporte') {
    // Só emite cartões a quem tem inscrição confirmada numa rota (Transporte Escolar).
    const staffRiders = staffSelected.filter((p) => isConfirmedRider(db, p.id));
    const batchRiders = batch ? batchStudents.filter((st) => isConfirmedRider(db, personKey('student', String(st.id)))) : [];
    const singleRider = !batch && !!student && isConfirmedRider(db, personKey('student', String(student.id)));
    if (batch && !s.classId) blockers.push('Escolha a turma.');
    else if (!staffRiders.length && (batch ? !batchRiders.length : !singleRider)) {
      blockers.push(
        batch
          ? 'Esta turma não tem alunos com inscrição confirmada no transporte escolar.'
          : student
            ? 'Este aluno não tem inscrição confirmada em nenhuma rota — inscreva-o em Transporte Escolar.'
            : 'Escolha um passageiro com inscrição confirmada (aluno, professor ou funcionário).'
      );
    }
    const dropped = staffSelected.length - staffRiders.length;
    if (dropped) warnings.push(`${dropped} docente(s)/funcionário(s) seleccionado(s) sem inscrição confirmada no transporte — não entram na emissão.`);
    const keys = [
      ...staffRiders.map((p) => p.id),
      ...(batch ? batchRiders.map((st) => personKey('student', String(st.id))) : singleRider ? [personKey('student', String(student!.id))] : [])
    ];
    const month = new Date().getMonth() + 1;
    const neverPaid = keys.filter((k) => { const r = enrollmentOf(db, k); return !(r && paidMonths(r, k, year).size); }).length;
    const monthUnpaid = keys.filter((k) => { const r = enrollmentOf(db, k); return !(r && isMonthPaid(r, k, year, month)); }).length;
    if (neverPaid) warnings.push(`${neverPaid} passageiro(s) ainda sem nenhuma mensalidade validada — o QR só permite o embarque depois do pagamento validado em Transporte Escolar.`);
    else if (monthUnpaid) warnings.push(`${monthUnpaid} passageiro(s) sem a mensalidade de ${MONTHS_PT[month - 1]} validada — o embarque fica bloqueado até ao pagamento.`);
  } else if (s.tab === 'funcionario') { if (!staffSelected.length) blockers.push('Escolha pelo menos um funcionário.'); }
  else if (batch) { if (!s.classId) blockers.push('Escolha a turma.'); else if (!batchStudents.length) blockers.push('Esta turma não tem alunos matriculados.'); }
  else if (!student) blockers.push('Escolha o aluno.');
  if (data && !batch && s.tab === 'historico' && !data.history.length) blockers.push('Este aluno ainda não tem histórico académico registado.');
  if (flowDoc) warnings.push(...flowDoc.warnings);
  // Ensino Médio (10.ª–13.ª): o cartão leva o curso; avisa quem não o tem definido.
  if (s.tab === 'estudante' || s.tab === 'transporte') {
    const list = batch ? batchData : data ? [data] : [];
    const medio = list.filter((d) => hasCurso(levelOfGrade(d.enrollment.grade)));
    const semCurso = medio.filter((d) => !d.enrollment.curso).length;
    if (semCurso) warnings.push(batch ? `${semCurso} aluno(s) do Ensino Médio sem curso definido — o campo Curso fica em branco (defina-o na matrícula ou no curso da turma).` : 'Este aluno do Ensino Médio não tem curso definido — o campo Curso fica em branco (defina-o na matrícula ou no curso da turma).');
  }
  if (batch && s.tab === 'historico') {
    const sem = batchData.filter((d) => !d.history.length).length;
    if (sem) warnings.push(`${sem} aluno(s) da turma sem histórico académico — saem com o aviso "Sem notas registadas".`);
  }

  return {
    students, staff, student, data, staffSelected, level, years: yearOptions(data, year), cardModels, flowModels, cardModel, flowModel,
    flowDoc, batchFlowDocs, batchData, cardItems, cardOrient: pair?.orient, hasAlt: !!cardModel?.alt, photos, batchStudents, isBatch: batch, overrides, docType, nextNumber, number, code, verifyValue, blockers, warnings
  };
}
