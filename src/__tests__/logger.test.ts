import { Logger, createLoggerFromEnv } from '../logger';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'gemini-mcp-logger-test-' + process.pid);
const TEST_LOG = join(TEST_DIR, 'test.log');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Logger', () => {
  it('filters messages below configured level', () => {
    const logger = new Logger({
      logPath: TEST_LOG,
      level: 'info',
      stderrPassthrough: false,
    });

    logger.debug('should be filtered');
    logger.info('should appear');

    const content = readFileSync(TEST_LOG, 'utf8').trim();
    const lines = content.split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).level).toBe('info');
  });

  it('creates log directory when it does not exist', () => {
    const nestedDir = join(TEST_DIR, 'a', 'b', 'c');
    const nestedLog = join(nestedDir, 'deep.log');

    const logger = new Logger({
      logPath: nestedLog,
      level: 'info',
      stderrPassthrough: false,
    });

    logger.info('creating directories');

    expect(existsSync(nestedLog)).toBe(true);
  });

  it('writes valid JSON on each line', () => {
    const logger = new Logger({
      logPath: TEST_LOG,
      level: 'debug',
      stderrPassthrough: false,
    });

    logger.debug('one');
    logger.info('two', { tool: 'generate_text', model: 'gemini-2.5-flash' });
    logger.warn('three');
    logger.error('four', { error: 'something broke' });

    const lines = readFileSync(TEST_LOG, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(4);

    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('message');
    }
  });

  it('includes extra fields in log entries', () => {
    const logger = new Logger({
      logPath: TEST_LOG,
      level: 'info',
      stderrPassthrough: false,
    });

    logger.info('tool call', {
      requestId: 'abc-123',
      tool: 'generate_text',
      model: 'gemini-2.5-flash',
      durationMs: 1500,
      tokenCount: 200,
    });

    const entry = JSON.parse(readFileSync(TEST_LOG, 'utf8').trim());
    expect(entry.requestId).toBe('abc-123');
    expect(entry.tool).toBe('generate_text');
    expect(entry.durationMs).toBe(1500);
  });

  it('rotates log files when size is exceeded', () => {
    const logger = new Logger({
      logPath: TEST_LOG,
      level: 'debug',
      maxFileSizeBytes: 100, // Very small to trigger rotation
      maxFiles: 2,
      stderrPassthrough: false,
    });

    // Write enough to exceed 100 bytes
    for (let i = 0; i < 10; i++) {
      logger.info(`Message number ${i} with some padding text to exceed the limit`);
    }

    // Original log should exist and rotated file should exist
    expect(existsSync(TEST_LOG)).toBe(true);
    expect(existsSync(`${TEST_LOG}.1`)).toBe(true);
  });

  it('does not throw when directory is unwritable', () => {
    const logger = new Logger({
      logPath: '/proc/nonexistent/impossible.log',
      level: 'info',
      stderrPassthrough: false,
    });

    // Should not throw
    expect(() => logger.info('this should not crash')).not.toThrow();
  });
});

describe('Logger.truncatePrompt', () => {
  it('returns short prompts unchanged', () => {
    expect(Logger.truncatePrompt('hello')).toBe('hello');
  });

  it('truncates prompts longer than maxLen', () => {
    const long = 'a'.repeat(200);
    const result = Logger.truncatePrompt(long, 100);
    expect(result).toHaveLength(103); // 100 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('handles empty string', () => {
    expect(Logger.truncatePrompt('')).toBe('');
  });

  it('uses default maxLen of 100', () => {
    const exactly100 = 'x'.repeat(100);
    expect(Logger.truncatePrompt(exactly100)).toBe(exactly100);

    const oneOver = 'x'.repeat(101);
    expect(Logger.truncatePrompt(oneOver)).toHaveLength(103);
  });
});

describe('createLoggerFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates a logger with defaults when no env vars set', () => {
    delete process.env.GEMINI_MCP_LOG_PATH;
    delete process.env.GEMINI_MCP_LOG_LEVEL;
    delete process.env.GEMINI_MCP_LOG_MAX_SIZE_MB;
    delete process.env.GEMINI_MCP_LOG_MAX_FILES;

    const logger = createLoggerFromEnv();
    expect(logger).toBeInstanceOf(Logger);
  });

  it('respects GEMINI_MCP_LOG_LEVEL env var', () => {
    process.env.GEMINI_MCP_LOG_LEVEL = 'error';
    process.env.GEMINI_MCP_LOG_PATH = TEST_LOG;

    const logger = createLoggerFromEnv();
    // Info should be filtered at error level
    logger.info('should not appear');

    // File should not exist (nothing written)
    expect(existsSync(TEST_LOG)).toBe(false);
  });
});
