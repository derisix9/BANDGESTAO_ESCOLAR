// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  operationManager,
  showOperationSuccess,
  showOperationError,
  beginOperationLoading,
  cancelOperationLoading,
  runGlobalOperation,
  successParts
} from '../src/context/OperationContext';

const st = () => operationManager.getState();

beforeEach(() => {
  vi.useFakeTimers();
  operationManager.notify({ isOpen: false, status: 'idle', successDetails: undefined });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('successParts', () => {
  it('texto curto «… com sucesso.» vira título', () => {
    expect(successParts('Caixa aberta com sucesso.')).toEqual({ message: 'Caixa aberta com sucesso!' });
  });
  it('texto longo ou sem «com sucesso» vira pormenor com título padrão', () => {
    expect(successParts('Pagamento simulado: 1 registado(s).')).toEqual({
      message: 'Operação feita com sucesso!',
      details: 'Pagamento simulado: 1 registado(s).'
    });
    expect(successParts('')).toEqual({ message: 'Operação feita com sucesso!' });
  });
});

describe('showOperationSuccess', () => {
  it('mostra carregamento, depois sucesso com pormenor, depois fecha', async () => {
    const p = showOperationSuccess('Feito!', { details: 'pormenor' });
    expect(st()).toMatchObject({ isOpen: true, status: 'loading' });

    await vi.advanceTimersByTimeAsync(660);
    expect(st()).toMatchObject({ isOpen: true, status: 'success', successMessage: 'Feito!', successDetails: 'pormenor' });

    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(st()).toMatchObject({ isOpen: false, status: 'idle' });
    expect(st().successDetails).toBeUndefined();
  });

  it('converte em sucesso um carregamento já aberto (sem novo carregamento falso)', async () => {
    beginOperationLoading('A guardar…');
    await vi.advanceTimersByTimeAsync(800);      // a operação real demorou mais que o mínimo
    const p = showOperationSuccess('Guardado!');
    // sem esperar: passa logo a sucesso
    await vi.advanceTimersByTimeAsync(0);
    expect(st()).toMatchObject({ status: 'success', successMessage: 'Guardado!' });
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    expect(st().isOpen).toBe(false);
  });

  it('minDuration 0 salta o carregamento (o chamador tem progresso próprio)', async () => {
    const p = showOperationSuccess('Pronto', { minDuration: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(st()).toMatchObject({ isOpen: true, status: 'success' });
    await vi.advanceTimersByTimeAsync(5000);
    await p;
  });

  it('uma operação mais recente não é fechada pela anterior', async () => {
    const first = showOperationSuccess('Primeira');
    await vi.advanceTimersByTimeAsync(660);       // primeira já em sucesso
    const second = showOperationSuccess('Segunda');
    expect(st().status).toBe('loading');          // segunda abriu o seu carregamento
    await vi.advanceTimersByTimeAsync(1300);      // o temporizador da primeira expira aqui
    expect(st().isOpen).toBe(true);               // ...mas não fecha a segunda
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([first, second]);
    expect(st().isOpen).toBe(false);
  });
});

describe('beginOperationLoading / cancelOperationLoading', () => {
  it('fecha o carregamento órfão (ninguém o converteu em sucesso)', async () => {
    beginOperationLoading('A testar…');
    expect(st()).toMatchObject({ isOpen: true, status: 'loading', loadingMessage: 'A testar…' });
    cancelOperationLoading();
    await vi.advanceTimersByTimeAsync(200);
    expect(st().isOpen).toBe(false);
  });

  it('não fecha se entretanto veio o sucesso (padrão run() → say("ok"))', async () => {
    beginOperationLoading('A guardar…');
    cancelOperationLoading();                      // finally do run()
    const p = showOperationSuccess('Guardado!');   // say('ok') logo a seguir
    await vi.advanceTimersByTimeAsync(200);
    expect(st()).toMatchObject({ isOpen: true });
    await vi.advanceTimersByTimeAsync(5000);
    await p;
  });

  it('não fecha o diálogo de uma segunda chamada run() em sequência', async () => {
    beginOperationLoading('Passo 1');
    cancelOperationLoading();
    beginOperationLoading('Passo 2');              // 2.º run() arranca de imediato
    await vi.advanceTimersByTimeAsync(200);
    expect(st()).toMatchObject({ isOpen: true, status: 'loading', loadingMessage: 'Passo 2' });
  });
});

describe('showOperationError', () => {
  it('mostra «Operação Não Realizada» com o motivo e fecha', async () => {
    const p = showOperationError('Sem permissão.');
    expect(st()).toMatchObject({ isOpen: true, status: 'error', errorMessage: 'Operação Não Realizada', errorDetails: 'Sem permissão.' });
    await vi.advanceTimersByTimeAsync(7000);
    await p;
    expect(st().isOpen).toBe(false);
  });
});

describe('runGlobalOperation (resolveSuccessText / successDetails)', () => {
  it('aplica o texto calculado depois da operação', async () => {
    let n = 0;
    const p = runGlobalOperation(() => { n = 3; }, { resolveSuccessText: () => `Foram registados ${n} itens.` });
    await vi.advanceTimersByTimeAsync(700);
    expect(st()).toMatchObject({ status: 'success', successMessage: 'Operação feita com sucesso!', successDetails: 'Foram registados 3 itens.' });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(st().isOpen).toBe(false);
  });

  it('usa o texto curto «… com sucesso» como título', async () => {
    const p = runGlobalOperation(() => {}, { resolveSuccessText: () => 'Caixa aberta com sucesso.' });
    await vi.advanceTimersByTimeAsync(700);
    expect(st()).toMatchObject({ status: 'success', successMessage: 'Caixa aberta com sucesso!' });
    expect(st().successDetails).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    await p;
  });

  it('um erro mostra o diálogo vermelho, nunca sucesso', async () => {
    const p = runGlobalOperation(() => { throw new Error('Falhou'); }, { resolveSuccessText: () => 'Tudo bem' });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(700);
    expect(st()).toMatchObject({ status: 'error', errorDetails: 'Falhou' });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).rejects.toThrow('Falhou');
  });
});
