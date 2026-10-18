// Pure helpers for file-list clipboard payloads: macOS NSFilenamesPboardType plists and Windows DROPFILES.

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function encodeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' } as Record<string, string>)[c]};`);
}

/** Extracts the <string> entries of an NSFilenamesPboardType property list. */
export function parseFilenamesPlist(xml: string): string[] {
  const out: string[] = [];
  const re = /<string>([\s\S]*?)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const p = decodeXml(m[1]!).trim();
    if (p) out.push(p);
  }
  return out;
}

export function buildFilenamesPlist(files: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n<array>\n' +
    files.map((f) => `\t<string>${encodeXml(f)}</string>\n`).join('') +
    '</array>\n</plist>\n'
  );
}

/** DROPFILES (fWide = 1) followed by UTF-16LE NUL-separated paths and a final double NUL. */
export function buildDropFiles(files: string[]): Buffer {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(20, 0); // pFiles
  header.writeUInt32LE(1, 16); // fWide
  const body = Buffer.from(`${files.join('\0')}\0\0`, 'utf16le');
  return Buffer.concat([header, body]);
}
