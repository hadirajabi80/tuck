// Image URLs: tuck://img/<variant>/<id> in Electron; generated data URLs in the browser mock.
import { imageUrl } from '@shared/ipc';
import { isMock } from './api';
import { mockImageUrl } from './mockApi';

export function clipImageSrc(id: string, variant: 'full' | 'thumb'): string {
  return isMock ? mockImageUrl(id, variant) : imageUrl(id, variant);
}
