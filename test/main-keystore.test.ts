import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createKeyStore, KeyStoreError } from '../src/main/keystore.ts';
import type { SafeStorageLike } from '../src/main/keystore.ts';

const KEY = 'sk-test-0123456789abcdef';

/** A reversible stand-in for the operating system's encryption: the bytes on disk differ from the key. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)),
    decryptString: (bytes) => Buffer.from(Buffer.from(bytes).map((b) => b ^ 0x5a)).toString('utf8'),
  };
}

function setup(available = true) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-keystore-'));
  const file = join(dir, 'sub', 'api-key.bin');
  return { store: createKeyStore({ file, safeStorage: fakeSafeStorage(available) }), file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a saved key comes back, is not on disk as plain text, and clear removes it', () => {
  const { store, file, done } = setup();
  try {
    assert.equal(store.has(), false);
    assert.equal(store.load(), undefined);
    store.save(`  ${KEY}\n`);
    assert.equal(store.has(), true);
    assert.equal(store.load(), KEY);
    assert.ok(!readFileSync(file).toString('utf8').includes(KEY), 'the file must not hold the key as text');
    store.clear();
    assert.equal(store.has(), false);
    assert.equal(store.load(), undefined);
  } finally {
    done();
  }
});

test('nothing is written when encryption is not available, and bad keys are refused without echoing them', () => {
  const none = setup(false);
  try {
    assert.throws(() => none.store.save(KEY), (e: unknown) => e instanceof KeyStoreError && !String(e.message).includes(KEY));
    assert.equal(none.store.has(), false);
  } finally {
    none.done();
  }
  const ok = setup();
  try {
    for (const bad of ['', 'short', 'has space inside the key 123456789', 'x'.repeat(500), 'sk-éééééééééééééééé']) {
      assert.throws(() => ok.store.save(bad), KeyStoreError);
    }
    assert.equal(ok.store.has(), false);
  } finally {
    ok.done();
  }
});

test('a file that cannot be decrypted gives no key instead of an error', () => {
  const { store, file, done } = setup();
  try {
    store.save(KEY);
    const other = createKeyStore({ file, safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: () => { throw new Error('wrong account'); } } });
    assert.equal(other.load(), undefined);
  } finally {
    done();
  }
});
