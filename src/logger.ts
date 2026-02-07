import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  tool?: string;
  model?: string;
  promptPreview?: string;
  durationMs?: number;
  tokenCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  error?: string;
}

export interface LoggerConfig {
  logPath: string;
  level: LogLevel;
  maxFileSizeBytes: number;
  maxFiles: number;
  stderrPassthrough: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  logPath: join(homedir(), '.gemini-mcp', 'server.log'),
  level: 'info',
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  maxFiles: 3,
  stderrPassthrough: true,
};

export function generateRequestId(): string {
  return randomUUID();
}

export class Logger {
  private config: LoggerConfig;
  private directoryEnsured = false;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static truncatePrompt(prompt: string, maxLen = 100): string {
    if (!prompt) return '';
    if (prompt.length <= maxLen) return prompt;
    return prompt.slice(0, maxLen) + '...';
  }

  debug(message: string, fields?: Partial<LogEntry>): void {
    this.log('debug', message, fields);
  }

  info(message: string, fields?: Partial<LogEntry>): void {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: Partial<LogEntry>): void {
    this.log('warn', message, fields);
  }

  error(message: string, fields?: Partial<LogEntry>): void {
    this.log('error', message, fields);
  }

  private log(level: LogLevel, message: string, fields?: Partial<LogEntry>): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.config.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields,
    };

    const line = JSON.stringify(entry) + '\n';

    if (this.config.stderrPassthrough) {
      process.stderr.write(line);
    }

    try {
      this.ensureLogDirectory();
      this.rotateIfNeeded();
      appendFileSync(this.config.logPath, line);
    } catch {
      // Logging must never crash the server
    }
  }

  private ensureLogDirectory(): void {
    if (this.directoryEnsured) return;
    try {
      mkdirSync(dirname(this.config.logPath), { recursive: true });
      this.directoryEnsured = true;
    } catch {
      // Directory may already exist or be unwritable
    }
  }

  private rotateIfNeeded(): void {
    try {
      const stats = statSync(this.config.logPath);
      if (stats.size < this.config.maxFileSizeBytes) return;
    } catch {
      return; // File doesn't exist yet
    }

    // Shift existing rotated files: .2 -> .3, .1 -> .2
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const from = i === 1
        ? `${this.config.logPath}.1`
        : `${this.config.logPath}.${i}`;
      const to = `${this.config.logPath}.${i + 1}`;

      // Delete the oldest if it would exceed maxFiles
      if (i === this.config.maxFiles - 1) {
        try { unlinkSync(to); } catch { /* may not exist */ }
      }

      try {
        renameSync(from, to);
      } catch {
        // Source may not exist
      }
    }

    // Current log -> .1
    try {
      renameSync(this.config.logPath, `${this.config.logPath}.1`);
    } catch {
      // May fail if file was removed
    }
  }
}

export function createLoggerFromEnv(): Logger {
  const envPath = process.env.GEMINI_MCP_LOG_PATH;
  const envLevel = process.env.GEMINI_MCP_LOG_LEVEL;
  const envMaxSize = process.env.GEMINI_MCP_LOG_MAX_SIZE_MB;
  const envMaxFiles = process.env.GEMINI_MCP_LOG_MAX_FILES;

  const config: Partial<LoggerConfig> = {};

  if (envPath) {
    config.logPath = envPath.startsWith('~')
      ? envPath.replace('~', homedir())
      : envPath;
  }

  if (envLevel && ['debug', 'info', 'warn', 'error'].includes(envLevel)) {
    config.level = envLevel as LogLevel;
  }

  if (envMaxSize) {
    const mb = parseInt(envMaxSize, 10);
    if (!isNaN(mb) && mb > 0) {
      config.maxFileSizeBytes = mb * 1024 * 1024;
    }
  }

  if (envMaxFiles) {
    const n = parseInt(envMaxFiles, 10);
    if (!isNaN(n) && n > 0) {
      config.maxFiles = n;
    }
  }

  return new Logger(config);
}
