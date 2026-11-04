import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The part of Electron's safeStorage this uses (the operating system encrypts for the signed-in user). */
export type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

export class KeyStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyStoreError';
  }
}

/**
 * Keeps one API key on disk, encrypted with the operating system's per-user protection
 * (Electron's safeStorage). If that protection is not available nothing is written: the key is never
 * stored as plain text. The key is only ever returned to the main process, never logged, and error
 * messages here never contain it.
 */
export function createKeyStore(options: { file: string; safeStorage: SafeStorageLike }) {
  const { file, safeStorage } = options;

  return {
    /** Whether a key can be stored on this machine at all. */
    available(): boolean {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },

    has(): boolean {
      return existsSync(file);
    },

    /** The stored key, or undefined when there is none or it cannot be decrypted (a different account or machine). */
    load(): string | undefined {
      try {
        if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return undefined;
        const key = safeStorage.decryptString(readFileSync(file));
        return key || undefined;
      } catch {
        return undefined;
      }
    },

    save(raw: string): void {
      const key = typeof raw === 'string' ? raw.trim() : '';
      if (key.length < 16 || key.length > 400 || /\s/.test(key) || /[^\x21-\x7e]/.test(key)) {
        throw new KeyStoreError('That does not look like an API key.');
      }
      if (!this.available()) throw new KeyStoreError('This computer cannot encrypt the key for your account, so it will not be saved.');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, safeStorage.encryptString(key));
      try {
        chmodSync(file, 0o600);
      } catch {
        // not every file system has modes
      }
    },

    clear(): void {
      rmSync(file, { force: true });
    },
  };
}
