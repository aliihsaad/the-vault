import { readdirSync, readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

function collectRendererSources(relativeUrl: string): string[] {
  const root = new URL(relativeUrl, import.meta.url);
  const files: string[] = [];

  for (const entry of readdirSync(root)) {
    const child = new URL(`${relativeUrl}/${entry}`, import.meta.url);
    const stat = statSync(child);
    if (stat.isDirectory()) {
      files.push(...collectRendererSources(`${relativeUrl}/${entry}`));
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry) || entry.endsWith('.d.ts')) {
      continue;
    }

    files.push(`${relativeUrl}/${entry}`);
  }

  return files;
}

describe('Spark Control Page composition', () => {
  it('composes the control page from the dedicated control view model', () => {
    const source = readSource('./components/spark/SparkControlPage.tsx');
    expect(source).toContain("import { useSparkControlViewModel } from '../../view-models/spark-control-view-model.js'");
    expect(source).toContain("import { SparkSessionFrame } from './SparkSessionFrame.js'");
    expect(source).toContain('useSparkControlViewModel()');
  });

  it('wires the live voice client and session controls into the page', () => {
    const source = readSource('./components/spark/SparkControlPage.tsx');
    expect(source).toContain('startVoiceSession');
    expect(source).toContain('stopVoiceSession');
    expect(source).toContain('sendTextMessage');
    expect(source).toContain('setSessionMode');
    expect(source).toContain('stopPlayback');
    expect(source).toContain('sessionStatusModel');

    const viewModelSource = readSource('./view-models/spark-control-view-model.ts');
    expect(viewModelSource).toContain('createSparkVoiceClient');
    expect(viewModelSource).toContain('getReadiness');
    expect(viewModelSource).toContain('voiceClient.subscribe');
    expect(viewModelSource).toContain("lastEvent.kind === 'status'");
    expect(viewModelSource).not.toContain("from '../spark/spark-voice-capture.js'");
    expect(viewModelSource).toContain("import('../spark/spark-voice-capture.js')");
    const captureSource = readSource('./spark/spark-voice-capture.ts');
    expect(captureSource).not.toContain("from '@the-vault/core'");
    // Capabilities strip, readiness checklist, skills toggle, and artifact viewer.
    expect(source).toContain('capabilities.map');
    expect(source).toContain('readiness.map');
    expect(source).toContain('toggleSkill(skill.skillId)');
    expect(source).toContain('viewArtifact(artifact.artifactName)');
  });

  it('renders the four inert session-frame panels bound to the typed contract', () => {
    const frameSource = readSource('./components/spark/SparkSessionFrame.tsx');
    expect(frameSource).toContain('clampSparkAudioLevel');
    expect(frameSource).toContain('SparkSessionFrame as SparkSessionFrameData');
    expect(frameSource).toContain('panels.map');
    // Visualizer renders live bars from the clamped audio level.
    expect(frameSource).toContain('spark-visualizer-bar');
    expect(frameSource).toContain('clampSparkAudioLevel(rawLevel)');
  });

  it('keeps the session-frame prop contract defined in core, not the renderer', () => {
    const contractSource = readSource('../../core/src/types/spark-session-frame.ts');
    expect(contractSource).toContain('export interface SparkSessionFrame');
    expect(contractSource).toContain('transcript: SparkTranscriptEntry[]');
    expect(contractSource).toContain('toolCalls: SparkToolCallEntry[]');
    expect(contractSource).toContain('audioLevel: number');
    expect(contractSource).toContain('canvasItems: SparkCanvasItem[]');
  });

  it('keeps renderer imports from the core barrel type-only so SQLite stays out of Vite', () => {
    const offenders = collectRendererSources('.')
      .filter((file) => {
        const imports = readSource(file).match(/import\s+[^;]*?\s+from ['"]@the-vault\/core['"];?/g) ?? [];
        return imports.some((statement) => !statement.startsWith('import type '));
      });

    expect(offenders).toEqual([]);
  });
});
