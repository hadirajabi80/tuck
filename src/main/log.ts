// Tiny logger: console + append-only file (userData/logs/main.log, rotated at 5 MB).
// Deliberately free of electron imports so every module (and its unit tests) can use it.
import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { format } from 'node:util';

type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX_BYTES = 5 * 1024 * 1024;
let stream: WriteStream | null = null;
let filePath: string | null = null;
const debugEnabled = !!process.env['TUCK_DEBUG'];

export function initLogFile(file: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      /* no previous log */
    }
    stream = createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
    filePath = file;
  } catch (err) {
    console.error('[log] cannot open log file', err);
  }
}

export function logFilePath(): string | null {
  return filePath;
}

function write(level: Level, scope: string, args: unknown[]): void {
  if (level === 'debug' && !debugEnabled) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${format(...args)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  stream?.write(`${line}\n`);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function logger(scope: string): Logger {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
  };
}

export function closeLog(): void {
  stream?.end();
  stream = null;
}
