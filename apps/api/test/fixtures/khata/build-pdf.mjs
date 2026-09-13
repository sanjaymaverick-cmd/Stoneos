import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, "pdf"), { recursive: true });
const json = JSON.parse(readFileSync(join(here, "customer-list.json"), "utf8"));

function escapePdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function buildSimplePdf(lines) {
  const ops = lines
    .map((line, i) => {
      const y = 800 - (i % 50) * 14;
      return `BT /F1 10 Tf 40 ${y} Td (${escapePdf(line)}) Tj ET`;
    })
    .join("\n");
  const stream = `${ops}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body);
}

const lines = ["Customer List Report", "Name You'll Get You'll Give"];
for (const p of json.parties) lines.push(`${p.name} ${p.youllGet} ${p.youllGive}`);
lines.push("Grand Total 12561248 163671");
writeFileSync(join(here, "pdf", "customer-list.pdf"), buildSimplePdf(lines));
writeFileSync(
  join(here, "pdf", "shakti-statement.pdf"),
  buildSimplePdf([
    "Shakti enterprise",
    "12/09/2026 Opening 577166 0 577166",
    "12/09/2026 Cash 97070 0 97070 480096",
    "12/09/2026 Vipul Cash 108162 0 108162 371934",
  ]),
);
console.log("wrote", lines.length, "customer-list lines");
