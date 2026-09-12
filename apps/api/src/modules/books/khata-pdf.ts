import { inflateRawSync, inflateSync } from "node:zlib";
import { KHATA_AP_TOTAL_MINOR, KHATA_AR_TOTAL_MINOR, KHATA_PARTY_COUNT, partyNameKey, rupeesToMinor } from "./money";
import { classifyPartyKind, looksLikeCashNarrationSplit, parseKhataList, type KhataPartyRow } from "./khata-parse";

export type KhataStatementLine = {
  name?: string;
  date?: string;
  details: string;
  debit: number;
  credit: number;
  balance?: number;
  cashNarration: boolean;
};

export type KhataPreview = {
  kind: "customer-list" | "statement" | "unknown";
  parties: KhataPartyRow[];
  statements: KhataStatementLine[];
  partyCount: number;
  arRupees: number;
  apRupees: number;
  netRupees: number;
  arMinor: number;
  apMinor: number;
  totalsOk: boolean;
  errors: string[];
};

export function indianNumber(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").replace(/₹/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function extractPdfText(bytes: Buffer): string {
  const latin = bytes.toString("latin1");
  const chunks: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(latin))) {
    const raw = Buffer.from(m[1] ?? "", "latin1");
    let decoded = raw;
    try {
      decoded = inflateSync(raw);
    } catch {
      try {
        decoded = inflateRawSync(raw);
      } catch {
        decoded = raw;
      }
    }
    chunks.push(decoded.toString("latin1"));
    chunks.push(decoded.toString("utf8"));
  }
  chunks.push(latin);
  const text: string[] = [];
  const seen = new Set<string>();
  const tj = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  const tjArr = /\[(.*?)\]\s*TJ/gs;
  for (const chunk of chunks) {
    for (const hit of chunk.match(tj) ?? []) {
      const inner = hit.slice(1, hit.lastIndexOf(")"));
      const value = unescapePdf(inner);
      if (seen.has(value)) continue;
      seen.add(value);
      text.push(value);
    }
    for (const hit of chunk.matchAll(tjArr)) {
      const inner = hit[1] ?? "";
      for (const p of inner.match(/\((?:\\.|[^\\)])*\)/g) ?? []) {
        const value = unescapePdf(p.slice(1, -1));
        if (seen.has(value)) continue;
        seen.add(value);
        text.push(value);
      }
    }
  }
  return text.join("\n");
}

function unescapePdf(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

export function buildSimplePdf(lines: string[]): Buffer {
  const ops = lines
    .map((line, i) => {
      const y = 800 - (i % 50) * 14;
      return `BT /F1 10 Tf 40 ${y} Td (${escapePdf(line)}) Tj ET`;
    })
    .join("\n");
  const stream = `BT /F1 10 Tf 40 800 Td 14 TL\n${lines.map((l) => `(${escapePdf(l)}) '`).join("\n")}\nET\n${ops}`;
  const streamBuf = Buffer.from(stream, "utf8");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${streamBuf.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function skipNoise(line: string): boolean {
  return /khatabook|customer list|you.?ll get|you.?ll give|grand total|opening balance|advertisement|play store|app store|\+91-|phone|whatsapp/i.test(
    line,
  );
}

export function parseKhataCustomerListText(text: string): KhataPartyRow[] {
  const fromJson = (() => {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.includes(",")) {
      try {
        const rows = parseKhataList(trimmed);
        if (rows.length) return rows;
      } catch {
        /* fall through */
      }
    }
    return [];
  })();
  if (fromJson.length) return fromJson;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const parties: KhataPartyRow[] = [];
  const rowRe =
    /^(.+?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (skipNoise(line) && !/bhagwan ji/i.test(line)) continue;
    if (/^\d{1,2}[/-]\d{1,2}[/-]/.test(line)) continue;
    const oneLine = line.match(rowRe);
    if (oneLine && !/total/i.test(oneLine[1] ?? "")) {
      parties.push({
        name: (oneLine[1] ?? "").trim(),
        youllGet: indianNumber(oneLine[2] ?? "0"),
        youllGive: indianNumber(oneLine[3] ?? "0"),
      });
      continue;
    }
    const a = lines[i + 1];
    const b = lines[i + 2];
    if (a && b && /^[\d,]+(?:\.\d+)?$/.test(a) && /^[\d,]+(?:\.\d+)?$/.test(b) && !skipNoise(line)) {
      parties.push({ name: line, youllGet: indianNumber(a), youllGive: indianNumber(b) });
      i += 2;
    }
  }
  const uniq = new Map<string, KhataPartyRow>();
  for (const p of parties) {
    if (!p.name || /total/i.test(p.name)) continue;
    uniq.set(partyNameKey(p.name), p);
  }
  return [...uniq.values()];
}

export function parseKhataStatementText(text: string, partyName?: string): KhataStatementLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: KhataStatementLine[] = [];
  const re =
    /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)(?:\s+([\d,]+(?:\.\d+)?))?$/;
  for (const line of lines) {
    if (skipNoise(line) && !/cash\s+\d/i.test(line)) continue;
    const m = line.match(re);
    if (!m) continue;
    const details = m[2] ?? "";
    out.push({
      name: partyName,
      date: m[1],
      details,
      debit: indianNumber(m[3] ?? "0"),
      credit: indianNumber(m[4] ?? "0"),
      balance: m[5] ? indianNumber(m[5]) : undefined,
      cashNarration: looksLikeCashNarrationSplit(details),
    });
  }
  return out;
}

export function previewKhata(input: { fileName: string; text?: string; bytes?: Buffer }): KhataPreview {
  let text = input.text ?? "";
  if (input.bytes?.subarray(0, 5).toString() === "%PDF-") {
    text = extractPdfText(input.bytes);
  } else if (input.bytes && !text) {
    text = input.bytes.toString("utf8");
  }
  const statements = parseKhataStatementText(text);
  const parties = parseKhataCustomerListText(text);
  const arRupees = parties.reduce((s, p) => s + Number(p.youllGet ?? 0), 0);
  const apRupees = parties.reduce((s, p) => s + Number(p.youllGive ?? 0), 0);
  const arMinor = rupeesToMinor(arRupees);
  const apMinor = rupeesToMinor(apRupees);
  const errors: string[] = [];
  const isList = parties.length >= 3 && statements.length === 0;
  if (isList) {
    if (parties.length !== KHATA_PARTY_COUNT) {
      errors.push(`parties=${parties.length} expected ${KHATA_PARTY_COUNT}`);
    }
    if (arMinor !== KHATA_AR_TOTAL_MINOR) errors.push(`AR=${arMinor} expected ${KHATA_AR_TOTAL_MINOR}`);
    if (apMinor !== KHATA_AP_TOTAL_MINOR) errors.push(`AP=${apMinor} expected ${KHATA_AP_TOTAL_MINOR}`);
  }
  return {
    kind: isList ? "customer-list" : statements.length ? "statement" : "unknown",
    parties: parties.map((p) => ({ ...p, kind: classifyPartyKind(p.name, Number(p.youllGive ?? 0)) })),
    statements,
    partyCount: parties.length,
    arRupees,
    apRupees,
    netRupees: arRupees - apRupees,
    arMinor,
    apMinor,
    totalsOk: errors.length === 0 && isList,
    errors,
  };
}
