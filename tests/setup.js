'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Global test environment setup
// ---------------------------------------------------------------------------

// Create a stable temp dir for the entire test suite.
// Each test file that needs isolation should create its own sub-temp dir.
const TEST_TEMP_DIR = path.join(os.tmpdir(), `potatoclaw-test-${process.pid}`);
if (!fs.existsSync(TEST_TEMP_DIR)) {
  fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
}

// Point DATA_DIR at the temp location so no source file accidentally writes
// to the real ~/.potatoclaw during tests.
process.env.DATA_DIR = TEST_TEMP_DIR;

// Silence logs in tests (avoids pino-pretty noise in CI output).
process.env.LOG_LEVEL = 'silent';

// Use a known password so SecretsStore tests are deterministic.
process.env.UI_PASSWORD = 'potatoclaw-test-password';

// Treat everything as production so pino emits JSON (not pino-pretty) which
// is easier to suppress — the silent level means nothing is emitted anyway.
process.env.NODE_ENV = 'production';

// ---------------------------------------------------------------------------
// Global afterAll: remove the shared temp dir
// ---------------------------------------------------------------------------
afterAll(() => {
  try {
    fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  } catch (_) {
    // best-effort
  }
});
