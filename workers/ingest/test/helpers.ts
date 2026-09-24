import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

import { parseGkg, type GkgRecord } from '../src/gdelt/gkg.ts';

/** Real GKG rows (see scripts/ingest/make-fixture.ts for how they were picked). */
export const FIXTURE_TEXT = readFileSync(
  new URL('./fixtures/gkg-sample.tsv', import.meta.url),
  'utf8',
);

export function fixtureRecords(): GkgRecord[] {
  return parseGkg(FIXTURE_TEXT).records;
}

/** The fixture row whose URL starts with `prefix`. */
export function fixtureRecord(prefix: string): GkgRecord {
  const record = fixtureRecords().find((r) => r.url.startsWith(prefix));
  if (record === undefined) throw new Error(`no fixture row for ${prefix}`);
  return record;
}

/** A minimal one-entry zip, laid out as APPNOTE.TXT §4.3 describes. */
export function makeZip(name: string, content: string, method: 0 | 8 = 8): Uint8Array<ArrayBuffer> {
  const raw = Buffer.from(content, 'utf8');
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const nameBytes = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + nameBytes.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return new Uint8Array(Buffer.concat([local, nameBytes, data, central, nameBytes, eocd]));
}
