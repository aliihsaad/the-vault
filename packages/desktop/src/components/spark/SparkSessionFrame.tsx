import { AudioLines, LayoutPanelLeft, MessageSquare, Wrench } from 'lucide-react';
import type {
  SparkCanvasItem,
  SparkSessionFrame as SparkSessionFrameData,
  SparkToolCallEntry,
  SparkTranscriptEntry,
  SparkVoiceStatus,
} from '@the-vault/core';
import { clampSparkAudioLevel } from '../../spark/spark-session-frame-renderer.js';
import type { SparkVoicePlaybackState } from '../../spark/spark-voice-client.js';
import type {
  SparkSessionPanelId,
  SparkSessionPanelModel,
} from '../../view-models/spark-control-view-model.js';

interface SparkSessionFrameProps {
  frame: SparkSessionFrameData;
  panels: SparkSessionPanelModel[];
  status?: SparkVoiceStatus;
  playback?: SparkVoicePlaybackState;
  onStopPlayback?: () => void;
}

const PANEL_ICONS: Record<SparkSessionPanelId, typeof MessageSquare> = {
  transcript: MessageSquare,
  'tool-calls': Wrench,
  visualizer: AudioLines,
  canvas: LayoutPanelLeft,
};

/**
 * Live session frame for the S3→S4 contract. It keeps the S1 empty states when
 * no session data exists, then renders transcript/tool/audio/canvas entries as
 * soon as the voice client folds host events into the frame.
 */
export function SparkSessionFrame({
  frame,
  panels,
  status = 'idle',
  playback = { playing: false, mimeType: null },
  onStopPlayback,
}: SparkSessionFrameProps) {
  return (
    <div className="spark-session-frame" aria-label="Spark live session frame">
      {panels.map((panel) => {
        const Icon = PANEL_ICONS[panel.id];
        return (
          <section
            key={panel.id}
            className={`snippet-card spark-session-panel spark-session-panel-${panel.id}`}
            aria-labelledby={`spark-session-panel-${panel.id}-title`}
          >
            <div className="snippet-head">
              <div>
                <div className="field-label" id={`spark-session-panel-${panel.id}-title`}>{panel.title}</div>
                <div className="field-help">Live S3 voice stream.</div>
              </div>
              <Icon size={16} />
            </div>
            <div className="spark-session-panel-body">
              {renderPanelBody(panel, frame, status, playback, onStopPlayback)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function renderPanelBody(
  panel: SparkSessionPanelModel,
  frame: SparkSessionFrameData,
  status: SparkVoiceStatus,
  playback: SparkVoicePlaybackState,
  onStopPlayback?: () => void,
) {
  if (panel.id === 'visualizer') {
    return renderVisualizer(frame.audioLevel, status, playback, onStopPlayback, panel.emptyLabel);
  }

  if (panel.id === 'transcript' && frame.transcript.length === 0) {
    return <p className="spark-session-empty">{panel.emptyLabel}</p>;
  }
  if (panel.id === 'transcript') {
    return renderTranscript(frame.transcript);
  }

  if (panel.id === 'tool-calls' && frame.toolCalls.length === 0) {
    return <p className="spark-session-empty">{panel.emptyLabel}</p>;
  }
  if (panel.id === 'tool-calls') {
    return renderToolCalls(frame.toolCalls);
  }

  if (panel.id === 'canvas' && frame.canvasItems.length === 0) {
    return <p className="spark-session-empty">{panel.emptyLabel}</p>;
  }
  if (panel.id === 'canvas') {
    return renderCanvas(frame.canvasItems);
  }

  return <p className="spark-session-empty">{panel.emptyLabel}</p>;
}

function renderTranscript(entries: SparkTranscriptEntry[]) {
  return (
    <ol className="spark-session-transcript" aria-label="Live transcript" aria-live="polite" aria-atomic="false">
      {entries.map((entry) => (
        <li key={entry.id} className={`spark-transcript-row spark-transcript-row-${entry.role}`}>
          <div className="spark-transcript-meta">
            <span>{entry.role === 'spark' ? 'Spark' : 'You'}</span>
            <span className={entry.final ? 'spark-transcript-final' : 'spark-transcript-partial'}>
              {entry.final ? 'Final' : 'Partial'}
            </span>
          </div>
          <p>{entry.text}</p>
        </li>
      ))}
    </ol>
  );
}

function renderToolCalls(toolCalls: SparkToolCallEntry[]) {
  return (
    <div className="spark-tool-call-list" aria-label="Tool-call timeline">
      {toolCalls.map((toolCall) => (
        <details key={toolCall.id} className={`spark-tool-call-row spark-tool-call-${toolCall.status}`} open>
          <summary>
            <span>{toolCall.name}</span>
            <span className="spark-tool-call-status">{toolCall.status}</span>
          </summary>
          {toolCall.args !== undefined ? (
            <pre className="spark-tool-call-json">{formatJson(toolCall.args)}</pre>
          ) : null}
          {toolCall.result !== undefined ? (
            <pre className="spark-tool-call-json">{formatJson(toolCall.result)}</pre>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function renderVisualizer(
  rawLevel: number,
  status: SparkVoiceStatus,
  playback: SparkVoicePlaybackState,
  onStopPlayback: (() => void) | undefined,
  emptyLabel: string,
) {
  const level = clampSparkAudioLevel(rawLevel);
  const barCount = 12;
  return (
    <div className="spark-visualizer" role="img" aria-label={`Voice level ${Math.round(level * 100)} percent`}>
      <div className="spark-visualizer-track" aria-hidden="true">
        {Array.from({ length: barCount }, (_, index) => {
          const phase = (index % 4) / 4;
          const height = Math.max(8, (level * 70) + (phase * 30));
          return (
            <span
              key={index}
              className="spark-visualizer-bar"
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
      <div className="spark-visualizer-meta">
        <span>{level > 0 ? `${Math.round(level * 100)}% level` : emptyLabel}</span>
        <span>{status}</span>
      </div>
      <div className="spark-audio-playback">
        <strong>Audio playback</strong>
        <span>{playback.playing ? playback.mimeType ?? 'playing' : 'Stopped'}</span>
        <button
          type="button"
          className="header-button"
          onClick={onStopPlayback}
          disabled={!playback.playing}
        >
          Stop audio
        </button>
      </div>
    </div>
  );
}

function renderCanvas(items: SparkCanvasItem[]) {
  return (
    <div className="spark-canvas-surface" aria-label="Spark canvas output">
      {items.map((item) => (
        <section key={item.id} className={`spark-canvas-item spark-canvas-item-${item.kind}`}>
          <div className="spark-canvas-item-kind">{item.kind}</div>
          {renderCanvasPayload(item)}
        </section>
      ))}
    </div>
  );
}

function renderCanvasPayload(item: SparkCanvasItem) {
  if (item.kind === 'markdown' && typeof item.payload === 'string') {
    return <pre className="spark-canvas-markdown">{item.payload}</pre>;
  }

  if (item.kind === 'table' && Array.isArray(item.payload)) {
    return renderTablePayload(item.payload);
  }

  if (item.kind === 'artifact' && isRecord(item.payload)) {
    return (
      <div className="spark-canvas-artifact">
        <strong>{String(item.payload.title ?? item.payload.name ?? 'Artifact')}</strong>
        <pre>{formatJson(item.payload.content ?? item.payload)}</pre>
      </div>
    );
  }

  return <pre className="spark-canvas-json">{formatJson(item.payload)}</pre>;
}

function renderTablePayload(rows: unknown[]) {
  const records = rows.filter(isRecord);
  const columns = Array.from(new Set(records.flatMap((row) => Object.keys(row))));
  if (records.length === 0 || columns.length === 0) {
    return <pre className="spark-canvas-json">{formatJson(rows)}</pre>;
  }

  return (
    <table className="spark-canvas-table">
      <thead>
        <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
      </thead>
      <tbody>
        {records.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return formatJson(value);
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
