import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Recoverable React error boundary (S5 hardening). Without this, any render-time
 * throw in a view crashes the whole Electron renderer to a blank white window —
 * the exact failure class S4 fought with the better-sqlite3 bundling bug. The
 * boundary catches the throw, shows an accessible (`role="alert"`) fallback with
 * a "Try again" control, and resets so the user is never stranded.
 */

export interface ErrorFallbackProps {
  /** The captured error, if any. */
  error?: Error;
  /** Re-mount the protected subtree. */
  onReset: () => void;
  /** Human-readable name of the area that failed (e.g. "Spark"). */
  label?: string;
}

/**
 * Default accessible fallback card. Pulled out as a pure component so the
 * presentation is unit-testable without driving the class through a real
 * commit-phase crash.
 */
export function DefaultErrorFallback({ error, onReset, label }: ErrorFallbackProps) {
  const where = label ? `${label} hit an error` : 'Something went wrong';
  const message = error?.message?.trim() ? error.message : 'Something went wrong while rendering this view.';

  return (
    <div className="panel empty-state empty-state-error spark-error-boundary" role="alert" aria-live="assertive">
      <span className="spark-error-boundary-icon" aria-hidden="true">
        <AlertTriangle size={20} />
      </span>
      <div className="spark-error-boundary-copy">
        <strong>{where}</strong>
        <p>{message}</p>
      </div>
      <button type="button" className="header-button" onClick={() => onReset()}>
        <RotateCcw size={14} />
        <span>Try again</span>
      </button>
    </div>
  );
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** Human-readable name of the area being protected. */
  label?: string;
  /** Custom fallback renderer; defaults to {@link DefaultErrorFallback}. */
  fallback?: (props: ErrorFallbackProps) => ReactNode;
  /** Side-effect hook for logging/telemetry on capture. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for diagnostics; never silently swallow.
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info);
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const fallback = this.props.fallback ?? DefaultErrorFallback;
      return fallback({ error: this.state.error, onReset: this.reset, label: this.props.label });
    }

    return this.props.children;
  }
}
