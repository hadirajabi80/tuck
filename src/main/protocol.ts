// tuck://img/full/<id> and tuck://img/thumb/<id> — serves stored PNGs to the renderer without IPC copies.
import { readFile } from 'node:fs/promises';
import { protocol } from 'electron';
import { imageStore } from './images/imageStore';
import { logger } from './log';

const log = logger('protocol');
const ID_RE = /^[0-9a-f-]{36}$/;

/** Must run before app 'ready'. */
export function registerTuckScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'tuck', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

export function handleTuckProtocol(): void {
  protocol.handle('tuck', async (request) => {
    try {
      const url = new URL(request.url);
      const [, variant, id] = url.pathname.split('/');
      if (url.hostname !== 'img' || (variant !== 'full' && variant !== 'thumb') || !id || !ID_RE.test(id)) {
        return new Response('Bad request', { status: 400 });
      }
      const data = await readFile(imageStore().pathFor(id, variant));
      return new Response(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=31536000, immutable' },
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('tuck:// failed', request.url, err);
      return new Response('Not found', { status: 404 });
    }
  });
}
