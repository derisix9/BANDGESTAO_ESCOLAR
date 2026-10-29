import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRADE_RULES, calculateCA, calculateMFD, calculateMT, calculateSituation, isExamClass, isEJAClass, getPautaRegime, calculateExamMF, calculateExamPart,
  calculateEjaMT, calculateEjaSubtotal, calculateExamPautaSituation, recalcMiniPautaRow, recomputeTrimesterRecord, normalizeGradeRules
} from '../src/utils/pautaCalculations';

describe('calculateMT (média simples das avaliações que contam: MAC, NPP, NPT)', () => {
  it('com as três avaliações: (MAC+NPP+NPT)/3', () => {
    expect(calculateMT(14, 12, 16)).toBe(14);
    expect(calculateMT(20, 20, 20)).toBe(20);
    expect(calculateMT(0, 0, 0)).toBe(0);
  });

  it('sem nenhuma nota devolve vazio (nunca 0)', () => {
    expect(calculateMT('', '', '')).toBe('');
  });

  it('avaliação vazia não conta: divide só pelas que existem', () => {
    expect(calculateMT('', 10, 14)).toBe(12); // (NPP+NPT)/2
    expect(calculateMT(10, '', 14)).toBe(12); // (MAC+NPT)/2
    expect(calculateMT('', '', 13)).toBe(13); // NPT/1
    expect(calculateMT(10, '', '')).toBe(10); // MAC/1
  });

  it('avaliação desmarcada não conta, mesmo com nota lançada', () => {
    expect(calculateMT(10, 10, 16, undefined, { NPP: false })).toBe(13);
    expect(calculateMT(10, 12, 16, undefined, { MAC: false, NPP: false })).toBe(16);
    expect(calculateMT(10, 12, 16, undefined, { MAC: false, NPP: false, NPT: false })).toBe('');
  });

  it('a nota 0 lançada é uma nota válida e conta', () => {
    expect(calculateMT(3, 0, '')).toBe(2); // (3+0)/2 = 1,5 -> 2
  });

  it('arredondamento oficial: 11,5 sobe para 12; desligado trunca para 11', () => {
    expect(calculateMT(13, 10, '')).toBe(12);
    expect(calculateMT(13, 10, '', { ...DEFAULT_GRADE_RULES, roundHalfUp: false })).toBe(11);
  });

  it('nunca sai do intervalo 0–20', () => {
    expect(calculateMT(30, 30, 30)).toBe(20);
    expect(calculateMT(-5, -5, -5)).toBe(0);
  });
});

describe('calculateMFD (média final da disciplina)', () => {
  it('média simples dos trimestres lançados', () => {
    expect(calculateMFD(10, 12, 14)).toBe(12);
    expect(calculateMFD(10, '', '')).toBe(10);
    expect(calculateMFD('', '', '')).toBe('');
  });

  it('com prova global: 60% contínua + 40% PG', () => {
    expect(calculateMFD(10, 12, 14, 10)).toBe(11); // 7,2 + 4 = 11,2
    expect(calculateMFD(10, 12, 14, 0)).toBe(7); // 7,2 + 0 → 7
  });

  it('média 9,5 sobe para 10 (arredondamento oficial) — o limiar de aprovação', () => {
    expect(calculateMFD(9, 10, '')).toBe(10);
    expect(calculateMFD(9, 10, '', undefined, { ...DEFAULT_GRADE_RULES, roundHalfUp: false })).toBe(9);
  });
});

describe('calculateCA', () => {
  it('escala 1–5 nos limiares', () => {
    expect([20, 17, 16.9, 14, 13.9, 10, 9.9, 7, 6.9, 0].map((n) => calculateCA(n))).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
    expect(calculateCA('')).toBe('');
  });
});

describe('classes de exame / EJA', () => {
  it('reconhece as classes de exame: 6.ª, 9.ª, 12.ª e 13.ª', () => {
    for (const c of ['6ª Classe', '6.ª Classe', '9ª Classe', '12.ª Classe', '13ª Classe (Técnico-Profissional)']) {
      expect(isExamClass(c), c).toBe(true);
    }
  });
  it('as restantes são de transição', () => {
    for (const c of ['1ª Classe', '5ª Classe', '7ª Classe', '8ª Classe', '10ª Classe', '11ª Classe', '16ª Classe', '', null, undefined, '1.º Ano (Licenciatura)']) {
      expect(isExamClass(c as any), String(c)).toBe(false);
    }
  });
  it('EJA nunca é classe de exame', () => {
    expect(isEJAClass('I Ano EJA (Módulos 1-2)')).toBe(true);
    expect(isExamClass('9ª Classe EJA')).toBe(false);
    expect(getPautaRegime('9ª Classe', 'Turma EJA A')).toBe('eja');
    expect(getPautaRegime('9ª Classe')).toBe('exame');
    expect(getPautaRegime('7ª Classe')).toBe('transicao');
  });
});

describe('calculateSituation', () => {
  const base = { hasAnyGrade: true, isDesistente: false };

  it('sem notas fica pendente, nunca aprovado por omissão', () => {
    expect(calculateSituation({ finalGrade: '', hasAnyGrade: false, isDesistente: false })).toBe('PENDENTE');
    expect(calculateSituation({ finalGrade: 15, hasAnyGrade: false, isDesistente: false })).toBe('PENDENTE');
  });

  it('desistente prevalece sobre qualquer nota', () => {
    expect(calculateSituation({ finalGrade: 18, hasAnyGrade: true, isDesistente: true })).toBe('DESISTIDO');
  });

  it('>= 10 aprova em qualquer classe', () => {
    expect(calculateSituation({ ...base, finalGrade: 10, classGrade: '7ª Classe' })).toBe('APROVADO');
    expect(calculateSituation({ ...base, finalGrade: 10, classGrade: '9ª Classe' })).toBe('APROVADO');
  });

  it('7 a 9,9: RECURSO só nas classes de exame e fora das disciplinas chave', () => {
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '9ª Classe' })).toBe('RECURSO');
    expect(calculateSituation({ ...base, finalGrade: 7, classGrade: '12ª Classe' })).toBe('RECURSO');
    expect(calculateSituation({ ...base, finalGrade: 9.9, classGrade: '6ª Classe' })).toBe('RECURSO');
    // disciplina chave: sem recurso
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '9ª Classe', isKeySubject: true })).toBe('REPROVADO');
    // classes de transição: nunca há recurso
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '7ª Classe' })).toBe('REPROVADO');
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '10ª Classe' })).toBe('REPROVADO');
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '4ª Classe' })).toBe('REPROVADO');
  });

  it('abaixo do mínimo de recurso reprova sempre', () => {
    expect(calculateSituation({ ...base, finalGrade: 6.9, classGrade: '9ª Classe' })).toBe('REPROVADO');
    expect(calculateSituation({ ...base, finalGrade: 0, classGrade: '9ª Classe' })).toBe('REPROVADO');
  });

  it('o NER decide quem fez Exame de Recurso', () => {
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '9ª Classe', ner: 10 })).toBe('APROVADO');
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '9ª Classe', ner: 9 })).toBe('REPROVADO');
  });

  it('usa os limiares configurados', () => {
    const rules = { ...DEFAULT_GRADE_RULES, passingGrade: 12, recursoMinGrade: 9 };
    expect(calculateSituation({ ...base, finalGrade: 11, classGrade: '9ª Classe', rules })).toBe('RECURSO');
    expect(calculateSituation({ ...base, finalGrade: 8, classGrade: '9ª Classe', rules })).toBe('REPROVADO');
  });
});

describe('classes de exame: MF = MFD×60% + Exame×40%', () => {
  it('exame = média do NEE e do NEO lançados', () => {
    expect(calculateExamPart(10, 14)).toBe(12);
    expect(calculateExamPart(10, '')).toBe(10);
    expect(calculateExamPart('', 14)).toBe(14);
    expect(calculateExamPart('', '')).toBe('');
  });
  it('NEE ou NEO desmarcado não conta', () => {
    expect(calculateExamPart(10, 14, { NEO: false })).toBe(10);
    expect(calculateExamPart(10, 14, { NEE: false })).toBe(14);
    expect(calculateExamPart(10, 14, { NEE: false, NEO: false })).toBe('');
  });
  it('MF com 10 em tudo = 10; com 12 de MFD e 8 de NEE = 7,2 + 3,2 = 10,4 -> 10', () => {
    expect(calculateExamMF(10, 10, 10)).toBe(10);
    expect(calculateExamMF(12, 8, '')).toBe(10);
    expect(calculateExamMF(14, 6, 10)).toBe(12); // 8,4 + 0,4×8 = 11,6 -> 12
  });
  it('sem exame lançado MF fica vazio; sem MFD também', () => {
    expect(calculateExamMF(12, '', '')).toBe('');
    expect(calculateExamMF('', 12, 12)).toBe('');
  });
});

describe('EJA: MT = (MAC+NPT)/2 + AAV + PCP', () => {
  it('subtotal e MT', () => {
    expect(calculateEjaSubtotal(14, 10)).toBe(12);
    expect(calculateEjaMT(14, 14, 2, 4)).toBe(20);
    expect(calculateEjaMT(10, 8, 1, 2)).toBe(12); // 9 + 1 + 2
    expect(calculateEjaMT(11, 10, 1, 2)).toBe(13.5); // 10,5 + 3, sem arredondar (como no modelo)
  });
  it('vazio ou desmarcado não conta', () => {
    expect(calculateEjaMT(10, '', 2, 4)).toBe(16); // subtotal só com o MAC (10) + 2 + 4
    expect(calculateEjaMT(10, 8, 1, 2, undefined, { AAV: false, PCP: false })).toBe(9);
    expect(calculateEjaMT('', '', '', '')).toBe('');
  });
  it('respeita os limites 14/14/2/4', () => {
    expect(calculateEjaMT(20, 20, 9, 9)).toBe(20);
  });
});

describe('Pauta Final de classe de exame', () => {
  const sit = (subjects: Array<{ grade: number | ''; isKey?: boolean; ner?: number | '' }>, classGrade = '9ª Classe') =>
    calculateExamPautaSituation({
      subjects: // mt3: 10 => o III Trimestre já tem nota (sem ele, a negativa não dá Recurso).
      subjects.map((s) => ({ grade: s.grade, isKey: !!s.isKey, ner: s.ner, mt3: 10 })),
      isDesistente: false,
      classGrade
    });

  it('sem negativas aprova', () => {
    expect(sit([{ grade: 12 }, { grade: 10 }])).toBe('APROVADO');
  });
  it('9.ª: até 2 negativas (não chave, 7 a 9,9) -> RECURSO; 3 -> REPROVADO', () => {
    expect(sit([{ grade: 8 }, { grade: 12 }])).toBe('RECURSO');
    expect(sit([{ grade: 8 }, { grade: 9 }, { grade: 12 }])).toBe('RECURSO');
    expect(sit([{ grade: 8 }, { grade: 9 }, { grade: 9 }, { grade: 12 }])).toBe('REPROVADO');
  });
  it('12.ª/13.ª: até 4 negativas -> RECURSO; 5 -> REPROVADO', () => {
    const four = [8, 8, 9, 9].map((g) => ({ grade: g }));
    expect(sit([...four, { grade: 12 }], '12ª Classe')).toBe('RECURSO');
    expect(sit([...four, { grade: 9 }, { grade: 12 }], '13ª Classe')).toBe('REPROVADO');
  });
  it('negativa em disciplina chave reprova directamente', () => {
    expect(sit([{ grade: 8, isKey: true }, { grade: 12 }])).toBe('REPROVADO');
  });
  it('nota abaixo do mínimo de recurso reprova', () => {
    expect(sit([{ grade: 5 }, { grade: 12 }])).toBe('REPROVADO');
  });
  it('NER >= 10 resolve o recurso; NER < 10 reprova', () => {
    expect(sit([{ grade: 8, ner: 11 }, { grade: 12 }])).toBe('APROVADO');
    expect(sit([{ grade: 8, ner: 9 }, { grade: 12 }])).toBe('REPROVADO');
    expect(sit([{ grade: 8, ner: 11 }, { grade: 9 }, { grade: 12 }])).toBe('RECURSO');
  });
  it('sem notas fica pendente', () => {
    expect(sit([{ grade: '' }])).toBe('PENDENTE');
  });
});

describe('recalcMiniPautaRow', () => {
  const row: any = {
    id: 'a', studentId: 'a', num: 1, name: 'A', gender: 'M', birthYear: 2010, age: 14, isDebtor: false, isDesistente: false,
    mac1: 8, npp1: 8, npt1: 8, mt1: '', mac2: 8, npp2: 8, npt2: 8, mt2: '', mac3: 8, npp3: 8, npt3: 8, mt3: '',
    mfd: '', pg: 20, ca: '', obs: '', nee: '', neo: '', ner: ''
  };
  const rules = DEFAULT_GRADE_RULES;

  it('classe de exame: ignora o PG, calcula MF e marca RECURSO só se não for chave', () => {
    const r = recalcMiniPautaRow(row, { regime: 'exame', classGrade: '9ª Classe', rules });
    expect(r.mfd).toBe(8);
    expect(r.mf).toBe('');
    expect(r.obs).toBe('RECURSO');
    expect(recalcMiniPautaRow(row, { regime: 'exame', classGrade: '9ª Classe', rules, isKeySubject: true }).obs).toBe('REPROVADO');
    const withExam = recalcMiniPautaRow({ ...row, nee: 14 }, { regime: 'exame', classGrade: '9ª Classe', rules });
    expect(withExam.mf).toBe(10); // 4,8 + 5,6 = 10,4
    expect(withExam.obs).toBe('APROVADO');
  });
  it('classe de transição: usa o PG e nunca dá recurso', () => {
    const r = recalcMiniPautaRow({ ...row, pg: 0 }, { regime: 'transicao', classGrade: '8ª Classe', rules });
    expect(r.mfd).toBe(5); // 4,8 + 0
    expect(r.obs).toBe('REPROVADO');
    expect(recalcMiniPautaRow(row, { regime: 'transicao', classGrade: '8ª Classe', rules }).mfd).toBe(13); // 4,8 + 8
  });
  it('NEE desmarcado não conta', () => {
    const r = recalcMiniPautaRow({ ...row, nee: 14 }, { regime: 'exame', classGrade: '9ª Classe', rules, enabled: { NEE: false } });
    expect(r.mf).toBe('');
  });
  it('EJA: MT pelo subtotal + AAV + PCP, sem PG', () => {
    const eja: any = { ...row, mac1: 14, npt1: 10, aav1: 2, pcp1: 4, npp1: 0, mac2: '', npt2: '', mac3: '', npt3: '' };
    const r = recalcMiniPautaRow(eja, { regime: 'eja', classGrade: '9ª Classe', rules });
    expect(r.mt1).toBe(18);
    expect(r.mfd).toBe(18);
  });
  it('recomputeTrimesterRecord respeita isEJA', () => {
    const r = recomputeTrimesterRecord({ mac1: 14, npt1: 10, aav1: 2, pcp1: 4, isEJA: true }, rules);
    expect(r.mt1).toBe(18);
    expect(recomputeTrimesterRecord({ mac1: 14, npt1: 10, npp1: 12 }, rules).mt1).toBe(12);
  });
});

describe('normalizeGradeRules', () => {
  it('sem configuração devolve a norma MED (e uma cópia)', () => {
    const r = normalizeGradeRules(null);
    expect(r).toEqual(DEFAULT_GRADE_RULES);
    expect(r).not.toBe(DEFAULT_GRADE_RULES);
  });

  it('preenche o que falta e aceita os nomes antigos', () => {
    const r = normalizeGradeRules({ passingGrade: 11, strictDecimals: false, roundRuleHalfUp: false } as any);
    expect(r.passingGrade).toBe(11);
    expect(r.macWeight).toBe(30);
    expect(r.strictDecimal).toBe(false);
    expect(r.roundHalfUp).toBe(false);
  });

  it('os pesos oficiais somam 100', () => {
    expect(DEFAULT_GRADE_RULES.macWeight + DEFAULT_GRADE_RULES.ppWeight + DEFAULT_GRADE_RULES.ptWeight).toBe(100);
  });
});
