"use client";
type Line = {
  description: string;
  quantity: number | null;
  unit: string | null;
  amount: number | null;
};
export type DocumentFields = {
  kind: "supplier_bill" | "delivery_note";
  partyName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  lines: Line[];
  uncertainFields: string[];
};
export function DocumentReview({
  value,
  onChange,
}: {
  value: DocumentFields;
  onChange: (v: DocumentFields) => void;
}) {
  const text = (
    key: "partyName" | "invoiceNumber" | "invoiceDate",
    label: string,
    type = "text",
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        value={value[key] ?? ""}
        onChange={(e) => onChange({ ...value, [key]: e.target.value || null })}
      />
    </label>
  );
  const amount = (key: "subtotal" | "taxAmount" | "total", label: string) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min="0"
        step="0.01"
        value={value[key] ?? ""}
        onChange={(e) =>
          onChange({
            ...value,
            [key]: e.target.value ? Number(e.target.value) : null,
          })
        }
      />
    </label>
  );
  const line = (i: number, patch: Partial<Line>) =>
    onChange({
      ...value,
      lines: value.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    });
  return (
    <>
      <label>
        Document type
        <select
          value={value.kind}
          onChange={(e) =>
            onChange({
              ...value,
              kind: e.target.value as DocumentFields["kind"],
            })
          }
        >
          <option value="supplier_bill">Supplier bill</option>
          <option value="delivery_note">Delivery note</option>
        </select>
      </label>
      {text("partyName", "Supplier / party")}
      {text("invoiceNumber", "Document number")}
      {text("invoiceDate", "Document date", "date")}
      {amount("subtotal", "Subtotal (₹)")}
      {amount("taxAmount", "Tax (₹)")}
      {amount("total", "Total (₹)")}
      {value.lines.map((l, i) => (
        <fieldset key={i}>
          <legend>Line {i + 1}</legend>
          <label>
            Description
            <input
              value={l.description}
              maxLength={1000}
              onChange={(e) => line(i, { description: e.target.value })}
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="0"
              step="0.001"
              value={l.quantity ?? ""}
              onChange={(e) =>
                line(i, {
                  quantity: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label>
            Unit
            <input
              value={l.unit ?? ""}
              onChange={(e) => line(i, { unit: e.target.value || null })}
            />
          </label>
          <label>
            Amount (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={l.amount ?? ""}
              onChange={(e) =>
                line(i, {
                  amount: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                lines: value.lines.filter((_, j) => j !== i),
              })
            }
          >
            Remove line
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            lines: [
              ...value.lines,
              { description: "", quantity: null, unit: null, amount: null },
            ],
          })
        }
      >
        Add line
      </button>
      <label>
        Fields still uncertain
        <textarea
          value={value.uncertainFields.join("\n")}
          onChange={(e) =>
            onChange({
              ...value,
              uncertainFields: e.target.value.split("\n").filter(Boolean),
            })
          }
        />
      </label>
    </>
  );
}
