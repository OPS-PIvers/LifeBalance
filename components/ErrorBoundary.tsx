import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleClearCacheAndReload = () => {
    if (window.caches) {
      // Try to clear caches if possible
      window.caches.keys().then((names) => {
        Promise.all(names.map((name) => window.caches.delete(name))).then(() => {
          window.location.reload();
        });
      }).catch(() => {
         window.location.reload();
      });
    } else {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-brand-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>

            <h1 className="text-xl font-bold text-brand-800">Something went wrong</h1>

            <p className="text-sm text-brand-500">
              The application encountered an unexpected error.
            </p>

            {this.state.error && (
              <div className="bg-red-50 p-3 rounded-lg text-left overflow-auto max-h-32 text-xs text-red-700 font-mono break-all">
                {this.state.error.toString()}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={this.handleReload}
                className="w-full bg-brand-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-brand-700 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={18} />
                <span>Reload Page</span>
              </button>

              <button
                 onClick={this.handleClearCacheAndReload}
                 className="text-xs text-brand-400 hover:text-brand-600 underline"
              >
                Clear Cache & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
