import { describe, expect, it } from 'vitest';

import {
  buildGraphifyArtifactProtocolUrl,
  parseGraphifyArtifactUrlRequest,
  requestGraphifyArtifactUrl,
} from './graphify-artifact-url.js';

describe('graphify artifact URL safety', () => {
  it('requests renderer artifact URLs through IPC using project and artifact identifiers only', async () => {
    const calls: unknown[] = [];
    const url = await requestGraphifyArtifactUrl(
      {
        getGraphifyArtifactUrl: async (input) => {
          calls.push(input);
          return {
            success: true,
            data: {
              url: 'vault-graphify://artifact?project=the-vault&artifact=graphHtml',
              artifactPath: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.html',
            },
          };
        },
      },
      { project: 'the-vault', artifact: 'graphHtml' },
    );

    expect(url).toBe('vault-graphify://artifact?project=the-vault&artifact=graphHtml');
    expect(calls).toEqual([{ project: 'the-vault', artifact: 'graphHtml' }]);
  });

  it('rejects arbitrary file URLs and traversal before IPC', async () => {
    await expect(requestGraphifyArtifactUrl(
      {
        getGraphifyArtifactUrl: async () => ({
          success: true,
          data: { url: 'vault-graphify://artifact?project=the-vault&artifact=graphHtml' },
        }),
      },
      { project: 'file:///C:/Users/Mini/.ssh/id_rsa', artifact: 'graphHtml' },
    )).rejects.toThrow('Project names cannot be URLs');

    expect(() => parseGraphifyArtifactUrlRequest({
      project: 'the-vault',
      artifact: '../graph.html',
    })).toThrow('Unsupported Graphify artifact');

    expect(() => parseGraphifyArtifactUrlRequest({
      project: '../the-vault',
      artifact: 'graphHtml',
    })).toThrow('Project names cannot contain path traversal');
  });

  it('rejects unsafe IPC responses and builds controlled protocol URLs', async () => {
    expect(buildGraphifyArtifactProtocolUrl({
      project: 'the-vault',
      artifact: 'graphHtml',
    })).toBe('vault-graphify://artifact?project=the-vault&artifact=graphHtml');

    await expect(requestGraphifyArtifactUrl(
      {
        getGraphifyArtifactUrl: async () => ({
          success: true,
          data: { url: 'file:///C:/Users/Mini/Desktop/secret.html' },
        }),
      },
      { project: 'the-vault', artifact: 'graphHtml' },
    )).rejects.toThrow('Graphify artifacts must use the controlled protocol');
  });
});
