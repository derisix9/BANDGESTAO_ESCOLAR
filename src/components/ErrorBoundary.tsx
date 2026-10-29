import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportError } from '../services/errorReporter';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary apanhou um erro não tratado:', error, errorInfo);
    reportError('react', error, { section: this.props.fallbackTitle ? String(this.props.fallbackTitle).slice(0, 80) : null });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div data-acl-ignore className="p-8 my-6 bg-white rounded-2xl border border-red-200 shadow-sm flex flex-col items-center text-center max-w-2xl mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-red-50 text-[#ac332b] flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-3xl">error</span>
          </div>
          <h2 className="text-xl font-headline font-bold text-slate-900 mb-2">
            {this.props.fallbackTitle || 'Ocorreu um erro ao carregar esta seção'}
          </h2>
          <p className="text-sm text-slate-500 mb-4 max-w-md">
            {this.state.error?.message || 'Falha inesperada na renderização da visualização.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 bg-[#0b1f3a] text-white text-xs font-bold rounded-xl hover:bg-[#7a0c0c] transition-colors shadow-xs flex items-center gap-2"
              type="button"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
              <span>Tentar Novamente</span>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors"
              type="button"
            >
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
