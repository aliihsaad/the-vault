import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SparkSessionFrame } from './components/spark/SparkSessionFrame.js';
import { buildSparkSessionPanels } from './view-models/spark-control-view-model.js';
import type { SparkSessionFrame as SparkSessionFrameData } from '@the-vault/core';

function render(frame: SparkSessionFrameData): string {
  return renderToStaticMarkup(React.createElement(SparkSessionFrame, {
    frame,
    panels: buildSparkSessionPanels(),
    status: 'thinking',
    playback: { playing: true, mimeType: 'audio/mpeg' },
    onStopPlayback: () => undefined,
  }));
}

describe('SparkSessionFrame live rendering', () => {
  it('renders streaming transcript turns with partial and final states', () => {
    const html = render(makeFrame());
    expect(html).toContain('spark-session-transcript');
    expect(html).toContain('Book a focus block');
    expect(html).toContain('Working on it');
    expect(html).toContain('Partial');
    expect(html).toContain('Final');
    expect(html).not.toContain('Waiting for session...');
  });

  it('renders expandable tool calls with args, status, and result', () => {
    const html = render(makeFrame());
    expect(html).toContain('spark-tool-call-row');
    expect(html).toContain('recall_memory');
    expect(html).toContain('running');
    expect(html).toContain('&quot;query&quot;');
    expect(html).toContain('calendar policy');
    expect(html).not.toContain('No tool calls yet');
  });

  it('renders an audio-reactive visualizer and playback control', () => {
    const html = render(makeFrame());
    expect(html).toContain('Voice level 72 percent');
    expect(html).toContain('spark-visualizer-bar');
    expect(html).toContain('Audio playback');
    expect(html).toContain('audio/mpeg');
    expect(html).toContain('Stop audio');
    expect(html).not.toContain('Audio inactive');
  });

  it('renders markdown, table, and result canvas items', () => {
    const html = render(makeFrame());
    expect(html).toContain('spark-canvas-item-markdown');
    expect(html).toContain('Plan updated');
    expect(html).toContain('<table');
    expect(html).toContain('Task');
    expect(html).toContain('Focus block');
    expect(html).toContain('spark-canvas-item-result');
    expect(html).toContain('&quot;ok&quot;');
    expect(html).not.toContain('Canvas is empty');
  });
});

function makeFrame(): SparkSessionFrameData {
  return {
    transcript: [
      { id: 'u1', role: 'user', text: 'Book a focus block', final: true, ts: 1 },
      { id: 's1', role: 'spark', text: 'Working on it', final: false, ts: 2 },
    ],
    toolCalls: [
      {
        id: 't1',
        name: 'recall_memory',
        args: { query: 'calendar policy' },
        status: 'running',
        result: { hits: ['calendar policy'] },
        ts: 3,
      },
    ],
    audioLevel: 0.72,
    canvasItems: [
      { id: 'c1', kind: 'markdown', payload: '## Plan updated' },
      {
        id: 'c2',
        kind: 'table',
        payload: [
          { Task: 'Focus block', Time: '09:00' },
        ],
      },
      { id: 'c3', kind: 'result', payload: { ok: true } },
    ],
  };
}
