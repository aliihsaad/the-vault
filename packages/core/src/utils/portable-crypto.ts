// ============================================================================
// Vault — Portable Encryption
// AES-256-GCM encryption that works in both Electron and plain Node.
// Used to share secrets (API keys) between the desktop app and MCP server
// via the shared vault database.
// ============================================================================

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

export interface PortableEncryptedValue {
  version: 1;
  scheme: 'aes-256-gcm-portable';
  cipherText: string;
  iv: string;
  authTag: string;
}

/**
 * Derive a deterministic encryption key from the vault root path
 * and machine-specific environment variables.
 */
function deriveKey(vaultRoot: string): Buffer {
  const seed = [
    vaultRoot,
    process.env.USERNAME || process.env.USER || '',
    process.env.COMPUTERNAME || process.env.HOSTNAME || '',
  ].join('|');

  const salt = createHash('sha256')
    .update('the-vault-portable-salt')
    .digest();

  return scryptSync(seed, salt, 32);
}

/**
 * Encrypt a string value using a portable AES-256-GCM scheme.
 * Returns null for empty values.
 */
export function portableEncrypt(value: string, vaultRoot: string): PortableEncryptedValue | null {
  if (!value) {
    return null;
  }

  const key = deriveKey(vaultRoot);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const cipherText = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    scheme: 'aes-256-gcm-portable',
    cipherText: cipherText.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt a portable encrypted value. Returns empty string on failure.
 */
export function portableDecrypt(value: unknown, vaultRoot: string): string {
  if (!value || typeof value !== 'object' || value === null) {
    return '';
  }

  const blob = value as Record<string, unknown>;
  if (
    blob.scheme !== 'aes-256-gcm-portable' ||
    typeof blob.cipherText !== 'string' ||
    typeof blob.iv !== 'string' ||
    typeof blob.authTag !== 'string'
  ) {
    return '';
  }

  try {
    const key = deriveKey(vaultRoot);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(blob.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));

    const plainText = Buffer.concat([
      decipher.update(Buffer.from(blob.cipherText, 'base64')),
      decipher.final(),
    ]);

    return plainText.toString('utf8');
  } catch {
    return '';
  }
}
