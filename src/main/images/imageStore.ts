// Image clips live as files: userData/images/<id>.png (original) + images/thumbs/<id>.png (longest side 240).
import { mkdirSync, promises as fsp, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nativeImage, type NativeImage } from 'electron';
import { LIMITS, type ClipImageMeta } from '../../shared/types';
import { logger } from '../log';

const log = logger('images');
const ID_RE = /^[0-9a-f-]{36}$/;

export class ImageStore {
  constructor(readonly dir: string) {}

  get thumbsDir(): string {
    return join(this.dir, 'thumbs');
  }

  init(): void {
    mkdirSync(this.thumbsDir, { recursive: true });
  }

  pathFor(id: string, variant: 'full' | 'thumb'): string {
    if (!ID_RE.test(id)) throw new Error('invalid image id');
    return variant === 'full' ? join(this.dir, `${id}.png`) : join(this.thumbsDir, `${id}.png`);
  }

  /** Stores the PNG and its thumbnail; returns the metadata saved in clips.image_json. */
  save(id: string, png: Buffer, decoded?: NativeImage): ClipImageMeta {
    const img = decoded ?? nativeImage.createFromBuffer(png);
    if (img.isEmpty()) throw new Error('cannot decode image');
    const { width, height } = img.getSize();
    const max = LIMITS.thumbMaxSide;
    let thumbPng = png;
    let tw = width;
    let th = height;
    if (width > max || height > max) {
      const scale = max / Math.max(width, height);
      tw = Math.max(1, Math.round(width * scale));
      th = Math.max(1, Math.round(height * scale));
      thumbPng = img.resize({ width: tw, height: th, quality: 'good' }).toPNG();
    }
    writeFileSync(this.pathFor(id, 'full'), png);
    writeFileSync(this.pathFor(id, 'thumb'), thumbPng);
    return { width, height, bytes: png.byteLength, file: `${id}.png`, thumb: `${id}.png`, thumbWidth: tw, thumbHeight: th };
  }

  /** Encodes a premultiplied BGRA bitmap to PNG (used by the Ditto DIB import). */
  encodeBitmap(bgra: Buffer, width: number, height: number): { png: Buffer; image: NativeImage } {
    const image = nativeImage.createFromBitmap(bgra, { width, height });
    return { png: image.toPNG(), image };
  }

  delete(id: string): void {
    if (!ID_RE.test(id)) return;
    for (const v of ['full', 'thumb'] as const) {
      try {
        rmSync(this.pathFor(id, v), { force: true });
      } catch (err) {
        log.warn('delete failed', id, err);
      }
    }
  }

  /** Removes image files whose clip no longer exists. */
  async sweepOrphans(knownIds: Set<string>): Promise<number> {
    let removed = 0;
    for (const dir of [this.dir, this.thumbsDir]) {
      let names: string[] = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const m = /^([0-9a-f-]{36})\.png$/.exec(name);
        if (!m || knownIds.has(m[1]!)) continue;
        await fsp.rm(join(dir, name), { force: true }).catch(() => undefined);
        removed++;
      }
    }
    if (removed) log.info(`swept ${removed} orphan image files`);
    return removed;
  }

  async totalBytes(): Promise<number> {
    let total = 0;
    for (const dir of [this.dir, this.thumbsDir]) {
      let names: string[] = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.png')) continue;
        try {
          total += (await fsp.stat(join(dir, name))).size;
        } catch {
          /* raced with a delete */
        }
      }
    }
    return total;
  }
}

let instance: ImageStore | null = null;

export function initImageStore(dir: string): ImageStore {
  instance = new ImageStore(dir);
  instance.init();
  return instance;
}

export function imageStore(): ImageStore {
  if (!instance) throw new Error('image store not initialised');
  return instance;
}
