import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  DefaultErrorFallback,
  ErrorBoundary,
} from './components/ErrorBoundary.js';

describe('ErrorBoundary', () => {
  it('renders its children unchanged when nothing throws', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ErrorBoundary,
        { label: 'Spark' },
        React.createElement('p', null, 'healthy child'),
      ),
    );
    expect(html).toContain('healthy child');
    expect(html).not.toContain('role="alert"');
  });

  it('derives an error state from a thrown error', () => {
    const error = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({
      hasError: true,
      error,
    });
  });

  it('renders the recoverable fallback once an error is captured', () => {
    // Drive the boundary into its error state directly (SSR does not run the
    // commit-phase catch), then render to prove the fallback is shown.
    const boundary = new ErrorBoundary({ label: 'Spark', children: null });
    boundary.state = { hasError: true, error: new Error('kaboom') };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain('kaboom');
    expect(html).toContain('Try again');
  });
});

describe('DefaultErrorFallback', () => {
  it('exposes an assertive alert, the section label, the message, and a retry control', () => {
    const html = renderToStaticMarkup(
      React.createElement(DefaultErrorFallback, {
        error: new Error('provider exploded'),
        onReset: () => undefined,
        label: 'Spark',
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Spark');
    expect(html).toContain('provider exploded');
    expect(html).toContain('Try again');
  });

  it('falls back to a generic message when the error has no message', () => {
    const html = renderToStaticMarkup(
      React.createElement(DefaultErrorFallback, {
        error: undefined,
        onReset: () => undefined,
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Something went wrong');
  });

  it('invokes onReset when the retry button is activated', () => {
    const onReset = vi.fn();
    const fallback = DefaultErrorFallback({ error: new Error('x'), onReset });
    // The retry button is the single interactive child; pull its onClick.
    const button = findRetryButton(fallback);
    expect(button).toBeTruthy();
    button?.props.onClick?.();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

/** Walk a rendered element tree to find the "Try again" button element. */
function findRetryButton(node: unknown): { props: { onClick?: () => void } } | null {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === 'button' && typeof element.props?.onClick === 'function') {
    return element as { props: { onClick?: () => void } };
  }
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findRetryButton(child);
    if (found) {
      return found;
    }
  }
  return null;
}
