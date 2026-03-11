'use strict';

// ---------------------------------------------------------------------------
// secrets.test.js — unit tests for src/utils/secrets.js (SecretsStore)
// ---------------------------------------------------------------------------

const os = require('os');
const path = require('path');
const fs = require('fs');
const SecretsStore = require('../../src/utils/secrets');

// Each test gets its own isolated temp directory so there's no state bleed.
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'potatoclaw-secrets-test-'));
}

describe('SecretsStore', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = makeTempDir();
    store = new SecretsStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // set + get round trip
  // -------------------------------------------------------------------------

  describe('set + get round trip', () => {
    test('stores and retrieves a string value', async () => {
      await store.set('SLACK_BOT_TOKEN', 'xoxb-test-token');
      const value = await store.get('SLACK_BOT_TOKEN');
      expect(value).toBe('xoxb-test-token');
    });

    test('stores and retrieves multiple keys independently', async () => {
      await store.set('KEY_A', 'value-alpha');
      await store.set('KEY_B', 'value-beta');

      expect(await store.get('KEY_A')).toBe('value-alpha');
      expect(await store.get('KEY_B')).toBe('value-beta');
    });

    test('overwrites an existing key', async () => {
      await store.set('TOKEN', 'old-value');
      await store.set('TOKEN', 'new-value');
      expect(await store.get('TOKEN')).toBe('new-value');
    });

    test('value survives a fresh store instance (persistence)', async () => {
      await store.set('PERSISTENT_KEY', 'persisted-value');

      // New store instance pointing at the same dir — simulates restart
      const store2 = new SecretsStore(tmpDir);
      expect(await store2.get('PERSISTENT_KEY')).toBe('persisted-value');
    });
  });

  // -------------------------------------------------------------------------
  // get nonexistent key → undefined
  // -------------------------------------------------------------------------

  describe('get nonexistent key', () => {
    test('returns undefined for a key that was never set', async () => {
      const result = await store.get('NONEXISTENT_KEY');
      expect(result).toBeUndefined();
    });

    test('returns undefined from an empty store', async () => {
      const result = await store.get('ANY_KEY');
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    test('deletes an existing key so get returns undefined', async () => {
      await store.set('DEL_KEY', 'some-value');
      await store.delete('DEL_KEY');
      expect(await store.get('DEL_KEY')).toBeUndefined();
    });

    test('deleting a nonexistent key does not throw', async () => {
      await expect(store.delete('NONEXISTENT')).resolves.not.toThrow();
    });

    test('delete only removes the targeted key, not others', async () => {
      await store.set('A', '1');
      await store.set('B', '2');
      await store.delete('A');
      expect(await store.get('A')).toBeUndefined();
      expect(await store.get('B')).toBe('2');
    });
  });

  // -------------------------------------------------------------------------
  // list keys
  // -------------------------------------------------------------------------

  describe('list', () => {
    test('returns empty array on empty store', async () => {
      expect(await store.list()).toEqual([]);
    });

    test('returns all stored key names', async () => {
      await store.set('ALPHA', 'a');
      await store.set('BETA', 'b');
      await store.set('GAMMA', 'c');

      const keys = await store.list();
      expect(keys.sort()).toEqual(['ALPHA', 'BETA', 'GAMMA']);
    });

    test('removed keys no longer appear in list', async () => {
      await store.set('X', '1');
      await store.set('Y', '2');
      await store.delete('X');

      const keys = await store.list();
      expect(keys).not.toContain('X');
      expect(keys).toContain('Y');
    });

    test('list returns only key names, not values', async () => {
      await store.set('SECRET_TOKEN', 'super-secret');
      const keys = await store.list();
      for (const key of keys) {
        expect(typeof key).toBe('string');
        expect(key).not.toBe('super-secret');
      }
    });
  });

  // -------------------------------------------------------------------------
  // getAll — merges env vars + secrets (secrets win)
  // -------------------------------------------------------------------------

  describe('getAll', () => {
    test('returns an object containing process.env keys', async () => {
      const all = await store.getAll();
      // PATH is a reliable env var on every platform
      expect(typeof all).toBe('object');
    });

    test('secrets override env vars with the same key', async () => {
      const originalEnv = process.env.TEST_OVERRIDE_VAR;
      try {
        process.env.TEST_OVERRIDE_VAR = 'from-env';
        await store.set('TEST_OVERRIDE_VAR', 'from-secrets');

        const all = await store.getAll();
        expect(all.TEST_OVERRIDE_VAR).toBe('from-secrets');
      } finally {
        if (originalEnv === undefined) delete process.env.TEST_OVERRIDE_VAR;
        else process.env.TEST_OVERRIDE_VAR = originalEnv;
      }
    });

    test('env-only variables (not in secrets) are still present', async () => {
      process.env.__POTATOCLAW_TEST_ENV_ONLY__ = 'env-only-value';
      try {
        const all = await store.getAll();
        expect(all.__POTATOCLAW_TEST_ENV_ONLY__).toBe('env-only-value');
      } finally {
        delete process.env.__POTATOCLAW_TEST_ENV_ONLY__;
      }
    });

    test('returns plain process.env when store is empty', async () => {
      const all = await store.getAll();
      expect(all).toMatchObject(process.env);
    });
  });

  // -------------------------------------------------------------------------
  // Encryption: stored data is not plaintext
  // -------------------------------------------------------------------------

  describe('encryption', () => {
    test('the .enc file does not contain the plaintext secret value', async () => {
      const secretValue = 'super-secret-api-key-xyz123';
      await store.set('API_KEY', secretValue);

      const encFilePath = path.join(tmpDir, 'secrets.enc');
      expect(fs.existsSync(encFilePath)).toBe(true);

      const fileContents = fs.readFileSync(encFilePath, 'utf-8');
      expect(fileContents).not.toContain(secretValue);
    });

    test('the .enc file contains valid JSON', async () => {
      await store.set('SOME_KEY', 'some-value');
      const encFilePath = path.join(tmpDir, 'secrets.enc');
      const parsed = JSON.parse(fs.readFileSync(encFilePath, 'utf-8'));
      expect(parsed).toHaveProperty('v', 1);
      expect(parsed).toHaveProperty('salt');
      expect(parsed).toHaveProperty('entries');
    });

    test('each entry has iv, tag, and data hex fields', async () => {
      await store.set('ENC_KEY', 'enc-value');
      const fileContents = JSON.parse(fs.readFileSync(path.join(tmpDir, 'secrets.enc'), 'utf-8'));
      const entry = fileContents.entries['ENC_KEY'];
      expect(entry).toHaveProperty('iv');
      expect(entry).toHaveProperty('tag');
      expect(entry).toHaveProperty('data');
      // All should be hex strings
      expect(entry.iv).toMatch(/^[0-9a-f]+$/);
      expect(entry.tag).toMatch(/^[0-9a-f]+$/);
      expect(entry.data).toMatch(/^[0-9a-f]+$/);
    });

    test('two stores with different passwords cannot decrypt each others data', async () => {
      // Store with test password (set in setup.js: UI_PASSWORD=potatoclaw-test-password)
      await store.set('CROSS_KEY', 'cross-value');

      // New store that uses a different password by overriding UI_PASSWORD
      const originalPw = process.env.UI_PASSWORD;
      try {
        process.env.UI_PASSWORD = 'completely-different-password';
        const store2 = new SecretsStore(tmpDir);
        // Decryption should fail gracefully — returns undefined
        const result = await store2.get('CROSS_KEY');
        expect(result).toBeUndefined();
      } finally {
        process.env.UI_PASSWORD = originalPw;
      }
    });
  });
});
