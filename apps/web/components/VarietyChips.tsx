"use client";
const varieties = [
  ["Imperial Red", "#8c4439"],
  ["Kashmir White", "#e1ded5"],
  ["Tan Brown", "#795747"],
  ["Absolute Black", "#242424"],
];
export function VarietyChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="chips">
      {varieties.map(([name, color]) => (
        <button
          key={name}
          type="button"
          className="chip"
          aria-pressed={value === name}
          onClick={() => onChange(value === name ? "" : name)}
        >
          <span className="swatch" style={{ backgroundColor: color }} />
          {name}
        </button>
      ))}
    </div>
  );
}
