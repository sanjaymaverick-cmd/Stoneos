"use client";
import { GRANITE_VARIETIES } from "@stoneos/contracts";
export function VarietyChips({
  value,
  onChange,
  options = [],
}: {
  value: string;
  onChange: (value: string) => void;
  options?: readonly string[];
}) {
  const varieties = Array.from(
    new Set([...GRANITE_VARIETIES, ...options, ...(value ? [value] : [])]),
  );
  return (
    <label>
      Variety filter
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All varieties</option>
        {varieties.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}
