/*
 * The ZIP half of an .xlsx file.
 *
 * An .xlsx is a ZIP container holding a handful of XML parts. Node ships zlib but
 * no ZIP writer, and this is the whole of what we need: store a list of named
 * byte blobs, deflated, with a central directory Excel can read.
 *
 * Deliberately not a general ZIP library. No directories, no ZIP64, no encryption,
 * no streaming — a daily report is kilobytes. What it does have is a fixed
 * timestamp, so the same data always produces byte-identical output and a test can
 * assert on it.
 */

import { deflateRawSync } from "node:zlib";

/** 1980-01-01 00:00:00, the earliest the DOS timestamp format can express. */
const DOS_EPOCH_TIME = 0;
const DOS_EPOCH_DATE = (1 << 5) | 1; // year 0 (=1980), month 1, day 1

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

/** Deflate, i.e. what every ZIP reader in existence supports. */
const METHOD_DEFLATE = 8;
/** 2.0 — the version that introduced deflate. We use nothing newer. */
const VERSION_NEEDED = 20;
/** Bit 11: the file name is UTF-8 rather than CP437. */
const FLAG_UTF8_NAMES = 0x0800;

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    const index = (crc ^ data[i]!) & 0xff;
    crc = (crc >>> 8) ^ CRC32_TABLE[index]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes, e.g. "xl/worksheets/sheet1.xml". */
  path: string;
  data: Buffer;
}

/**
 * Pack entries into a ZIP archive.
 *
 * Order matters to Excel only in that `[Content_Types].xml` should come first;
 * callers are responsible for that, because this function preserves the order given.
 */
export function zipSync(entries: readonly ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const uncompressedSize = entry.data.length;
    const checksum = crc32(entry.data);
    const compressed = deflateRawSync(entry.data, { level: 9 });

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8_NAMES, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_EPOCH_TIME, 10);
    local.writeUInt16LE(DOS_EPOCH_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION_NEEDED, 4); // version made by
    central.writeUInt16LE(VERSION_NEEDED, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8_NAMES, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_EPOCH_TIME, 12);
    central.writeUInt16LE(DOS_EPOCH_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    localChunks.push(local, compressed);
    centralChunks.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with start of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // archive comment length

  return Buffer.concat([...localChunks, centralDirectory, end]);
}
