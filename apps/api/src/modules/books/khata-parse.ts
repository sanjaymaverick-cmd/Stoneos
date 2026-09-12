export type KhataPartyRow = {
  name: string;
  youllGet?: number;
  youllGive?: number;
  details?: string;
  kind?: "customer" | "supplier" | "job";
  phone?: string;
};

export function classifyPartyKind(name: string, youllGive: number): "customer" | "supplier" | "job" {
  if (/\bjob\b/i.test(name) || /charging job/i.test(name)) return "job";
  if (youllGive > 0) return "supplier";
  return "customer";
}

export function looksLikeCashNarrationSplit(details: string): boolean {
  return /cash\s+\d/i.test(details);
}

export function parseKhataList(raw: string): KhataPartyRow[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as { parties?: KhataPartyRow[] } | KhataPartyRow[];
    return Array.isArray(parsed) ? parsed : parsed.parties ?? [];
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const out: KhataPartyRow[] = [];
  for (const line of lines.slice(1)) {
    if (/total|grand total|opening balance/i.test(line)) continue;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) continue;
    out.push({
      name: cols[0] ?? "",
      youllGet: Number(String(cols[1] ?? "0").replace(/,/g, "")) || 0,
      youllGive: Number(String(cols[2] ?? "0").replace(/,/g, "")) || 0,
    });
  }
  return out.filter((r) => r.name);
}
