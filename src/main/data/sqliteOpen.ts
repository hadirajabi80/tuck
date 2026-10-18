// Opens a SQLite database file that may be wrapped in zip or gzip (Ditto backups are .zdb = gzip).
// Format is sniffed from magic bytes, never the extension. Archives are stream-decompressed to a temp file
// (os.tmpdir()) which the caller removes with cleanup(). The source file is never written.
import { randomBytes } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';

export type SqliteSourceKind = 'sqlite' | 'zip' | 'gzip';

export class SqliteOpenError extends Error {
  constructor(
    readonly code: 'unrecognized' | 'read-failed',
    message: string,
  ) {
    super(message);
  }
}

export interface OpenedSqlite {
  /** Path of the plain SQLite file to open (the source itself, or a temp file). */
  path: string;
  kind: SqliteSourceKind;
  /** Temp file to delete (null when the source was opened directly). */
  temp: string | null;
  cleanup(): void;
}

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

export function readHead(file: string, n = 16): Buffer {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

export function sniff(head: Uint8Array): SqliteSourceKind | null {
  if (head.length >= 16 && SQLITE_MAGIC.equals(Buffer.from(head.subarray(0, 16)))) return 'sqlite';
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
  return null;
}

function tempPath(): string {
  return join(tmpdir(), `tuck-import-${process.pid}-${randomBytes(6).toString('hex')}.db`);
}

function removeTemp(p: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(p + suffix, { force: true });
    } catch {
      /* best effort */
    }
  }
}

async function gunzipTo(src: string, dest: string): Promise<void> {
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
}

/** Streams a zip through fflate and writes the first entry that starts with the SQLite magic to `dest`. */
async function unzipFirstSqlite(src: string, dest: string): Promise<boolean> {
  let found = false;
  let fd: number | null = null;
  let error: Error | null = null;
  const unzip = new Unzip((file: UnzipFile) => {
    if (found || file.name.endsWith('/')) return;
    let first = true;
    let mine = false;
    file.ondata = (err, chunk, final) => {
      if (err) {
        error = err;
        return;
      }
      if (first) {
        first = false;
        if (!found && sniff(chunk) === 'sqlite') {
          found = true;
          mine = true;
          fd = openSync(dest, 'w');
        } else {
          file.terminate();
          return;
        }
      }
      if (mine && fd !== null) {
        if (chunk.length) writeSync(fd, chunk);
        if (final) {
          closeSync(fd);
          fd = null;
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(src, { highWaterMark: 1 << 20 })) {
      unzip.push(chunk as Buffer, false);
      if (error) throw error;
    }
    unzip.push(new Uint8Array(0), true);
    if (error) throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
  return found;
}

export async function openSqliteSource(src: string): Promise<OpenedSqlite> {
  let head: Buffer;
  try {
    head = readHead(src, 16);
  } catch (err) {
    throw new SqliteOpenError('read-failed', (err as Error).message);
  }
  const kind = sniff(head);
  if (!kind) throw new SqliteOpenError('unrecognized', "This doesn't look like a Ditto database.");
  if (kind === 'sqlite') return { path: src, kind, temp: null, cleanup: () => undefined };

  const dest = tempPath();
  try {
    if (kind === 'gzip') {
      await gunzipTo(src, dest);
      if (sniff(readHead(dest, 16)) !== 'sqlite') throw new SqliteOpenError('unrecognized', 'The archive does not contain a SQLite database.');
    } else {
      const ok = await unzipFirstSqlite(src, dest);
      if (!ok) throw new SqliteOpenError('unrecognized', 'The zip file does not contain a SQLite database.');
    }
  } catch (err) {
    removeTemp(dest);
    if (err instanceof SqliteOpenError) throw err;
    throw new SqliteOpenError('read-failed', (err as Error).message);
  }
  return { path: dest, kind, temp: dest, cleanup: () => removeTemp(dest) };
}
