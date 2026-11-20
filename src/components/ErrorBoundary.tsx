import { Component, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import i18n from '@/i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  private handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const title = i18n.t('home.errorBoundaryTitle');
    const body = i18n.t('home.errorBoundaryBody');
    const reloadLabel = i18n.t('home.errorBoundaryReload');
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-neutral-200">
          <span className="flex size-14 items-center justify-center rounded-full bg-danger-50 text-danger-600">
            <AlertCircle className="size-7" aria-hidden />
          </span>
          <h1 className="text-xl font-bold text-neutral-900">{title}</h1>
          <p className="text-sm text-neutral-600">{body}</p>
          <button
            type="button"
            onClick={this.handleReload}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-base font-medium text-white transition hover:bg-primary-700"
          >
            <RefreshCw className="size-4" aria-hidden />
            {reloadLabel}
          </button>
        </div>
      </div>
    );
  }
}
