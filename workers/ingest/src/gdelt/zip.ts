/**
 * Just enough zip to open a GDELT file: one entry, deflated, under 4 GB.
 *
 * A zip library would cost bundle size and CPU for features we never use. The
 * inflate itself is the platform's DecompressionStream, which is native code in
 * both Workers and Node, so the only JavaScript here is reading three headers.
 * Offsets are from the ZIP File Format Specification (APPNOTE.TXT) §4.3.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
/** The EOCD record ends with a comment of at most 65535 bytes. */
const EOCD_SEARCH_BYTES = EOCD_MIN_BYTES + 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressed: Uint8Array;
  readonly size: number;
}

export class ZipError extends Error {
  override readonly name = 'ZipError';
}

function findEndOfCentralDirectory(view: DataView): number {
  const floor = Math.max(0, view.byteLength - EOCD_SEARCH_BYTES);
  for (let at = view.byteLength - EOCD_MIN_BYTES; at >= floor; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  throw new ZipError('not a zip file: no end-of-central-directory record');
}

/** The single entry of a one-file zip, still compressed. */
export function readSingleEntry(bytes: Uint8Array): ZipEntry {
  if (bytes.byteLength < EOCD_MIN_BYTES) throw new ZipError('not a zip file: too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEndOfCentralDirectory(view);
  const entries = view.getUint16(eocd + 10, true);
  if (entries !== 1) throw new ZipError(`expected one entry, found ${entries}`);

  const central = view.getUint32(eocd + 16, true);
  if (central + 46 > bytes.byteLength || view.getUint32(central, true) !== CENTRAL_SIGNATURE) {
    throw new ZipError('bad central directory');
  }
  const method = view.getUint16(central + 10, true);
  const compressedSize = view.getUint32(central + 20, true);
  const size = view.getUint32(central + 24, true);
  const nameLength = view.getUint16(central + 28, true);
  const local = view.getUint32(central + 42, true);
  if (compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) {
    throw new ZipError('zip64 is not supported');
  }
  const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength));

  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new ZipError('bad local header');
  }
  // The local header's name and extra lengths can differ from the central
  // directory's, so the data offset must come from the local header.
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  if (start + compressedSize > bytes.byteLength) throw new ZipError('entry runs past the end');

  return { name, method, compressed: bytes.subarray(start, start + compressedSize), size };
}

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

/** The entry's contents as UTF-8 text. */
export async function unzipText(bytes: Uint8Array): Promise<string> {
  const entry = readSingleEntry(bytes);
  // Copy into a fresh buffer: Blob wants an ArrayBuffer-backed view, and
  // subarray shares the (possibly larger) download buffer.
  const body = new Blob([entry.compressed.slice()]).stream();

  if (entry.method === METHOD_STORED) return streamText(body);
  if (entry.method !== METHOD_DEFLATE) {
    throw new ZipError(`unsupported compression method ${entry.method}`);
  }
  return streamText(body.pipeThrough(new DecompressionStream('deflate-raw')));
}
