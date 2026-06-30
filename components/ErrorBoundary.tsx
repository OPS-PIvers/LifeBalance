import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
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

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-brand-50 dark:bg-brand-900 flex items-center justify-center p-4">
          <div className="surface-section shadow-raised rounded-card p-6 max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 bg-money-bgNeg dark:bg-money-neg/15 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-money-neg dark:text-money-negDark" />
            </div>

            <h1 className="font-display text-xl font-semibold tracking-tight text-brand-900 dark:text-brand-50">
              Something went wrong
            </h1>

            <p className="text-sm text-brand-500 dark:text-brand-400">
              The application encountered an unexpected error.
            </p>

            {this.state.error && (
              <div className="bg-money-bgNeg dark:bg-money-neg/15 p-3 rounded-card text-left overflow-auto max-h-32 text-xs text-money-neg dark:text-money-negDark font-mono break-all">
                {this.state.error.toString()}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <Button
                size="lg"
                onClick={this.handleReload}
                className="w-full"
                leftIcon={<RefreshCw size={18} />}
              >
                <span>Reload Page</span>
              </Button>

              <Button
                variant="link"
                size="sm"
                onClick={this.handleClearCacheAndReload}
              >
                Clear Cache &amp; Reload
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
