import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface VaultDirectorySizeSummary {
  bytes: number;
  files: number;
  directories: number;
  displaySize: string;
}

export async function getDirectorySizeSummary(root: string): Promise<VaultDirectorySizeSummary> {
  const stats = await walkDirectory(root);
  return {
    ...stats,
    displaySize: formatByteSize(stats.bytes),
  };
}

async function walkDirectory(directoryPath: string): Promise<Omit<VaultDirectorySizeSummary, 'displaySize'>> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  let bytes = 0;
  let files = 0;
  let directories = 0;

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      directories += 1;
      const child = await walkDirectory(entryPath);
      bytes += child.bytes;
      files += child.files;
      directories += child.directories;
      continue;
    }

    if (entry.isFile()) {
      const fileStat = await lstat(entryPath);
      bytes += fileStat.size;
      files += 1;
    }
  }

  return { bytes, files, directories };
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = value >= 10 || Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(1);

  return `${formatted} ${units[unitIndex]}`;
}
