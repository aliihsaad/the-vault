import type {
  SparkBrainHostFindQuery,
  SparkBrainHostMemoryItem,
  SparkBrainHostSaveInput,
  VaultBrainStoreHost,
} from './services/spark-brain-vault-store.js';

/**
 * Minimal in-memory stand-in for the real Vault class, exposing only the
 * subset of methods the Spark Brain store depends on. Shared across Spark
 * Brain store/adapter tests.
 */
export class FakeVaultHost implements VaultBrainStoreHost {
  private readonly projects = new Set<string>();
  private readonly items = new Map<string, SparkBrainHostMemoryItem>();
  private counter = 0;

  getProject(name: string): { name: string } | null {
    return this.projects.has(name) ? { name } : null;
  }

  createProject(name: string): { name: string } {
    this.projects.add(name);
    return { name };
  }

  saveMemory(input: SparkBrainHostSaveInput): { item: SparkBrainHostMemoryItem } {
    this.counter += 1;
    const itemUid = `vm_fake_${this.counter}`;
    const item: SparkBrainHostMemoryItem = {
      itemUid,
      project: input.project,
      subject: input.subject,
      content: input.content ?? null,
      tags: input.tags ?? [],
    };
    this.items.set(itemUid, item);
    this.projects.add(input.project);
    return { item };
  }

  findMemory(query: SparkBrainHostFindQuery): SparkBrainHostMemoryItem[] {
    return [...this.items.values()].filter((item) => {
      if (query.project && item.project !== query.project) return false;
      if (query.subject && item.subject !== query.subject) return false;
      if (query.tags && !query.tags.every((tag) => item.tags.includes(tag))) return false;
      return true;
    });
  }

  updateMemory(
    itemUid: string,
    updates: Partial<SparkBrainHostMemoryItem>,
  ): SparkBrainHostMemoryItem | null {
    const existing = this.items.get(itemUid);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.items.set(itemUid, updated);
    return updated;
  }
}
