export function formatInr(value: string): string {
  return `₹${formatAmount(value, 2)}`;
}

export function formatAmount(value: string, scale = 2): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const raw = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d+)?$/.test(raw)) return value;
  const [whole, fraction = ""] = raw.split(".");
  const padded = scale === 0 ? "" : fraction.padEnd(scale, "0").slice(0, scale);
  const digits = whole.replace(/^0+(?=\d)/, "");
  let grouped = digits;
  if (digits.length > 3) {
    const tail = digits.slice(-3);
    const head = digits.slice(0, -3);
    const parts: string[] = [];
    for (let index = head.length; index > 0; index -= 2) {
      parts.unshift(head.slice(Math.max(0, index - 2), index));
    }
    grouped = `${parts.join(",")},${tail}`;
  }
  const suffix = padded ? `.${padded}` : "";
  return `${negative ? "-" : ""}${grouped}${suffix}`;
}

export function userTypeLabel(userType: string): string {
  if (userType === "OWNER") return "Owner";
  if (userType === "OFFICE") return "Office";
  if (userType === "YARD") return "Yard";
  return userType;
}

export function userTypeWork(userType: string): string {
  if (userType === "OWNER") {
    return "You can add the office and the yard, and you can do every job.";
  }
  if (userType === "OFFICE") {
    return "You record purchases, sales, job work, receipts, and payments.";
  }
  if (userType === "YARD") {
    return "You record blocks, cutting, grinding, polishing, and stock.";
  }
  return "";
}
