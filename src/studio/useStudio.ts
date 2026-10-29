/**
 * Hook do Estúdio de Documentos: guarda o estado (reducer), calcula a vista (assemble) e expõe as
 * acções da interface. Regra de ouro: um documento só é exportado depois de ter o seu número
 * oficial — a emissão é registada em Processos Académicos → Documentos e o QR leva esse número.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { buildStudioData, levelOfGrade } from './data';
import { defaultExtras } from './flow';
import { fileToDataUrl, toInlineImage, urlToDataUrl } from './images';
import { assembleStudio } from './assemble';
import type { StudioView } from './assemble';
import { initialState, studioReducer } from './state';
import type { IssuedInfo, StudioState } from './state';
import { suggestedModelId } from './session';
import type { StudioTab } from './session';
import { isConfirmedRider, parsePersonKey, personKey } from '../utils/transportPass';
import { exportCardsPptxFile, exportFlowDocx, exportFlowDocxBatch, exportHistorico, exportHistoricoBatch } from './actions';
import { classNumber } from './format';
import { snapshotFromState } from './snapshot';
import { setPublicInstitution, buildPublicLink } from '../utils/publicLink';
import { publishPublicRecords, keysFromScenes } from '../services/publicVerify';

export interface StudioNotice { ok: boolean; text: string }

const BRASAO_URL = '/pauta/insignia_angola.png';

export function useStudio(db: SchoolDatabase, role: UserRole) {
  const acl = useAccessControl(role);
  const [state, dispatch] = useReducer(studioReducer, db.settings?.currentAcademicYear || '', initialState);
  const [notice, setNotice] = useState<StudioNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  setPublicInstitution(dbService.activeInstitutionId);
  const view: StudioView = useMemo(() => assembleStudio(db, state), [db, state]);

  // Imagens por omissão: brasão da República e logótipo da escola (só se o utilizador ainda não pôs outro).
  const logoUrl = view.data?.school.logoUrl || db.settings?.logoUrl || '';
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!stateRef.current.images.brasao) {
        const b = await urlToDataUrl(BRASAO_URL);
        if (alive && b && !stateRef.current.images.brasao) dispatch({ type: 'image', slot: 'brasao', src: b });
      }
      if (logoUrl && !stateRef.current.images.logo) {
        const l = await urlToDataUrl(logoUrl);
        if (alive && l && !stateRef.current.images.logo) dispatch({ type: 'image', slot: 'logo', src: l });
      }
    })();
    return () => { alive = false; };
  }, [logoUrl]);

  const studentData = useCallback((id: string, year?: string) => {
    const st = (db.students || []).find((x) => String(x.id) === id);
    return st ? buildStudioData(db, st, year || stateRef.current.year || undefined) : null;
  }, [db]);

  const setTab = useCallback((tab: StudioTab) => {
    const d = studentData(stateRef.current.studentId);
    dispatch({ type: 'tab', tab, modelId: suggestedModelId(tab, d) });
    setNotice(null);
  }, [studentData]);

  const pickStudent = useCallback((id: string) => {
    const d = id ? studentData(id) : null;
    dispatch({
      type: 'student', id, modelId: suggestedModelId(stateRef.current.tab, d),
      classNum: d?.enrollment.classNum ?? classNumber(d?.enrollment.grade) ?? null, extras: d ? defaultExtras(d) : null
    });
    setNotice(null);
  }, [studentData]);

  const pickImage = useCallback(async (slot: string, file: File) => {
    try {
      dispatch({ type: 'image', slot, src: await fileToDataUrl(file, slot === 'foto' ? 900 : 1200), user: true });
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message || 'Não foi possível carregar a imagem.' });
    }
  }, []);

  /** Regista a emissão (número + código) se ainda não existir para o que está no ecrã. */
  const ensureIssued = useCallback(async (): Promise<{ state: StudioState; view: StudioView } | null> => {
    const s = stateRef.current;
    const v = assembleStudio(db, s);
    if (v.blockers.length) { setNotice({ ok: false, text: v.blockers[0] }); return null; }
    if (s.tab === 'transporte' && v.docType) {
      // Cartões de transporte: um registo TRSP por passageiro (aluno, docente ou funcionário),
      // todos com inscrição confirmada — os cartões no ecrã já vêm filtrados pelo assemble.
      type TItem = { key: string; kind: 'aluno' | 'professor' | 'funcionario'; id: string; name: string; number?: string };
      const items: TItem[] = [];
      for (const p of v.staffSelected) {
        if (!isConfirmedRider(db, p.id)) continue;
        const parsed = parsePersonKey(p.id);
        if (!parsed) continue;
        items.push({ key: p.id, kind: parsed.kind === 'docente' ? 'professor' : 'funcionario', id: parsed.id, name: p.name, number: p.number });
      }
      const studs = v.isBatch
        ? v.batchStudents.filter((x) => isConfirmedRider(db, personKey('student', String(x.id))))
        : v.student && isConfirmedRider(db, personKey('student', String(v.student.id))) ? [v.student] : [];
      for (const x of studs) items.push({ key: personKey('student', String(x.id)), kind: 'aluno', id: String(x.id), name: x.name, number: x.procNumber });
      const todo = items.filter((p) => !s.batchIssued[p.key]);
      if (!todo.length) return { state: s, view: v };
      if (!acl.can('documentos.emitir')) { setNotice({ ok: false, text: acl.denyMessage('documentos.emitir') }); return null; }
      const map: Record<string, IssuedInfo> = { ...s.batchIssued };
      let err = '';
      try {
        await runGlobalOperation(() => {
          for (const p of todo) {
            const r = dbService.issueAcademicDocument({
              studentId: p.kind === 'aluno' ? p.id : '', type: v.docType!, academicYear: s.year || undefined, purpose: s.purpose,
              person: p.kind === 'aluno' ? undefined : { kind: p.kind, id: p.id, name: p.name, number: p.number },
              snapshot: {
                ...snapshotFromState(s, { studentId: p.kind === 'aluno' ? p.id : '', staffIds: p.kind === 'aluno' ? [] : [p.key], docEdits: {} }),
                transportKey: p.key
              }
            });
            if (r.success && r.document) map[p.key] = { id: r.document.id, number: r.document.number, code: r.document.verificationCode, at: r.document.issuedAt };
            else { err = r.error || 'Não foi possível registar o cartão de transporte.'; break; }
          }
        }, { loadingMessage: `A registar ${todo.length} cartão(ões) de transporte...`, requiredRule: 'documentos.emitir', userRole: role });
      } catch (e: any) { err = e?.message || 'Sem permissão para esta operação.'; }
      dispatch({ type: 'batchIssued', map });
      if (err) { setNotice({ ok: false, text: err }); return null; }
      const next = { ...s, batchIssued: map };
      return { state: next, view: assembleStudio(db, next) };
    }
    if (s.tab === 'funcionario' && v.docType) {
      // Crachás: um registo por funcionário/professor, cada um com a sua receita para reimprimir.
      const todo = v.staffSelected.filter((p) => !s.batchIssued[p.id]);
      if (!todo.length) return { state: s, view: v };
      if (!acl.can('documentos.emitir')) { setNotice({ ok: false, text: acl.denyMessage('documentos.emitir') }); return null; }
      const map: Record<string, IssuedInfo> = { ...s.batchIssued };
      let err = '';
      try {
        await runGlobalOperation(() => {
          for (const p of todo) {
            const r = dbService.issueAcademicDocument({
              studentId: p.id, type: v.docType!, academicYear: s.year || undefined, purpose: s.purpose,
              person: { kind: p.kind === 'docente' ? 'professor' : 'funcionario', id: p.id, name: p.name, number: p.number },
              snapshot: snapshotFromState(s, { staffIds: [p.id], docEdits: {} })
            });
            if (r.success && r.document) map[p.id] = { id: r.document.id, number: r.document.number, code: r.document.verificationCode, at: r.document.issuedAt };
            else { err = r.error || 'Não foi possível registar o crachá.'; break; }
          }
        }, { loadingMessage: `A registar ${todo.length} crachá(s)...`, requiredRule: 'documentos.emitir', userRole: role });
      } catch (e: any) { err = e?.message || 'Sem permissão para esta operação.'; }
      dispatch({ type: 'batchIssued', map });
      if (err) { setNotice({ ok: false, text: err }); return null; }
      const next = { ...s, batchIssued: map };
      return { state: next, view: assembleStudio(db, next) };
    }
    if (v.isBatch && v.docType) {
      const todo = v.batchStudents.filter((x) => !s.batchIssued[String(x.id)]);
      if (!todo.length) return { state: s, view: v };
      if (!acl.can('documentos.emitir')) { setNotice({ ok: false, text: acl.denyMessage('documentos.emitir') }); return null; }
      const map: Record<string, IssuedInfo> = { ...s.batchIssued };
      let err = '';
      try {
        await runGlobalOperation(() => {
          for (const st of todo) {
            const r = dbService.issueAcademicDocument({ studentId: String(st.id), type: v.docType!, academicYear: s.year || undefined, purpose: s.purpose, snapshot: snapshotFromState(s, { studentId: String(st.id), docEdits: {} }) });
            if (r.success && r.document) map[String(st.id)] = { id: r.document.id, number: r.document.number, code: r.document.verificationCode, at: r.document.issuedAt };
            else { err = r.error || 'Não foi possível registar um dos documentos.'; break; }
          }
        }, { loadingMessage: `A registar ${todo.length} documentos...`, requiredRule: 'documentos.emitir', userRole: role });
      } catch (e: any) { err = e?.message || 'Sem permissão para esta operação.'; }
      dispatch({ type: 'batchIssued', map });
      if (err) { setNotice({ ok: false, text: err }); return null; }
      const next = { ...s, batchIssued: map };
      return { state: next, view: assembleStudio(db, next) };
    }
    if (v.docType && s.issued) { dbService.updateAcademicDocumentSnapshot(s.issued.id, snapshotFromState(s)); return { state: s, view: v }; }
    if (!v.docType) return { state: s, view: v };
    if (!acl.can('documentos.emitir')) { setNotice({ ok: false, text: acl.denyMessage('documentos.emitir') }); return null; }
    let info: IssuedInfo | null = null;
    let error = '';
    try {
      await runGlobalOperation(() => {
        const r = dbService.issueAcademicDocument({ studentId: String(v.student?.id || ''), type: v.docType!, academicYear: s.year || undefined, purpose: s.purpose, snapshot: snapshotFromState(s) });
        if (r.success && r.document) info = { id: r.document.id, number: r.document.number, code: r.document.verificationCode, at: r.document.issuedAt };
        else error = r.error || 'Não foi possível registar o documento.';
      }, { loadingMessage: 'A registar o documento...', requiredRule: 'documentos.emitir', userRole: role });
    } catch (e: any) {
      error = e?.message || 'Sem permissão para esta operação.';
    }
    if (!info) { setNotice({ ok: false, text: error || 'Não foi possível registar o documento.' }); return null; }
    dispatch({ type: 'issued', info });
    const next = { ...s, issued: info as IssuedInfo };
    return { state: next, view: assembleStudio(db, next) };
  }, [db, acl, role]);

  /** Publica o registo público das pessoas que aparecem nos QR / códigos de barras do que vai sair. */
  const publishForView = useCallback(async (v: StudioView, tab: string) => {
    try {
      const keys = keysFromScenes(v.cardItems.flatMap((it) => [it.front, it.back]));
      if (tab === 'historico') {
        if (v.data?.person?.id) keys.push(`s:${v.data.person.id}`);
        for (const d of v.batchData || []) keys.push(`s:${d.person.id}`);
      }
      if (keys.length) {
        const r = await publishPublicRecords(db, keys, dbService.activeInstitutionId);
        if (r.error === 'permissao') setNotice({ ok: false, text: 'Não foi possível sincronizar os QR dos cartões. Tente novamente; se continuar, contacte o administrador.' });
        else if (r.error === 'rede') setNotice({ ok: false, text: 'Sem ligação para sincronizar os QR dos cartões. Ligue à internet e exporte/imprima de novo.' });
      }
    } catch (e) { console.warn('[public_verify]', e); }
  }, [db, setNotice]);

  // Publica os registos assim que os cartões estão em pré-visualização (não só ao exportar).
  useEffect(() => {
    if (!view.cardItems.length && state.tab !== 'historico') return;
    const t = window.setTimeout(() => { void publishForView(view, state.tab); }, 1500);
    return () => window.clearTimeout(t);
  }, [view.cardItems, state.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Exporta o documento do separador actual no formato certo (DOCX, PPTX ou PDF). */
  const exportCurrent = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ready = await ensureIssued();
      if (!ready) return;
      const { state: sReady, view: vReady } = ready;
      // Fotos/imagens remotas → data URL, para o canvas não ficar "tainted" ao exportar.
      const images: Record<string, string | undefined> = {};
      for (const [k, src] of Object.entries(sReady.images)) images[k] = await toInlineImage(src);
      const photos = await Promise.all((vReady.photos || []).map((p) => toInlineImage(p)));
      const v = { ...vReady, photos } as StudioView;
      const s: StudioState = { ...sReady, images };
      await publishForView(v, s.tab);
      const number = v.isBatch ? `turma-${v.batchStudents.length}` : s.tab === 'funcionario' ? `${v.staffSelected.length}-crachas` : s.tab === 'transporte' ? `${v.cardItems.length}-cartoes-transporte` : v.docType ? v.number : undefined;
      let file = '';
      if (v.flowDoc) {
        if (v.isBatch && v.batchFlowDocs.length) {
          file = await exportFlowDocxBatch({ docs: v.batchFlowDocs, images: s.images, overrides: v.overrides, number, brasao: s.images.brasao });
        } else {
          file = await exportFlowDocx({ doc: v.flowDoc, images: s.images, overrides: v.overrides, number, brasao: s.images.brasao });
        }
      } else if (v.cardModel && v.cardItems.length) {
        file = await exportCardsPptxFile({ model: v.cardModel, items: v.cardItems, sides: s.sides, images: s.images, photos: v.photos, overrides: v.overrides, number });
      } else if (s.tab === 'historico' && (v.data || v.isBatch)) {
        if (v.isBatch) {
          file = await exportHistoricoBatch({
            items: v.batchData.map((d) => ({ data: d, number: s.batchIssued[d.person.id]?.number, code: s.batchIssued[d.person.id]?.code, verifyUrl: buildPublicLink('student', d.person.id, { dl: 'historico' }) })),
            images: s.images, trimestres: s.trimestres, number
          });
        } else if (v.data) {
          file = await exportHistorico({ data: v.data, images: s.images, number, code: s.issued?.code || v.code, verifyUrl: buildPublicLink('student', v.data.person.id, { dl: 'historico' }), trimestres: s.trimestres });
        }
      } else {
        setNotice({ ok: false, text: 'Não há nada para exportar.' });
        return;
      }
      setNotice({ ok: true, text: `Ficheiro ${file} gerado${number ? ` · registo ${number}` : ''}.` });
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message || 'Falhou a exportação.' });
    } finally {
      setBusy(false);
    }
  }, [busy, ensureIssued, publishForView]);

  /** Regista a emissão sem exportar (para imprimir a partir da pré-visualização com o número oficial). */
  const issueOnly = useCallback(async () => {
    if (busy) return null;
    setBusy(true);
    try {
      const ready = await ensureIssued();
      if (ready) await publishForView(ready.view, ready.state.tab);
      if (ready?.view.docType) setNotice({ ok: true, text: ready.view.isBatch || ready.state.tab === 'funcionario' || ready.state.tab === 'transporte' ? `${ready.state.tab === 'funcionario' ? ready.view.staffSelected.length : ready.state.tab === 'transporte' ? ready.view.cardItems.length : ready.view.batchStudents.length} documentos registados.` : `Documento registado: ${ready.view.number}.` });
      return ready;
    } finally {
      setBusy(false);
    }
  }, [busy, ensureIssued, publishForView]);

  return {
    state, view, dispatch, notice, setNotice, busy, setTab, pickStudent, pickImage, exportCurrent, issueOnly,
    canIssue: acl.can('documentos.emitir'), level: view.data ? levelOfGrade(view.data.enrollment.grade) : undefined
  };
}
