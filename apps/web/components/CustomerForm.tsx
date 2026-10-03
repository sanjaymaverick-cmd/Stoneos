"use client";

/*
 * Adding a buyer.
 *
 * The GSTIN is the field that matters. It decides whether a bill carries CGST+SGST
 * or IGST, and it is printed on the invoice — a buyer saved without one is treated
 * as an unregistered local sale for every bill they ever get. It used to be that
 * this form sent nothing but a name, so that is exactly what happened.
 *
 * The state code is not asked for separately: the first two characters of a GSTIN
 * ARE the state, so it is read off and shown back. Only a buyer with no GSTIN has
 * to be told where they are.
 */

import { FormEvent, useState } from "react";
import { apiFetch, isQueued } from "../lib/api";

/** Two state digits, a PAN, an entity code, a Z, a checksum. Format only. */
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

/** The states a granite yard in Rajasthan actually bills. */
const STATES: Array<{ code: string; name: string }> = [
  { code: "08", name: "Rajasthan" },
  { code: "07", name: "Delhi" },
  { code: "06", name: "Haryana" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "33", name: "Tamil Nadu" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
];

const stateName = (code: string) => STATES.find((s) => s.code === code)?.name ?? null;

export type EditableCustomer = {
  id: string;
  name: string;
  gstin?: string | null;
  stateCode?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  contactInfo?: string | null;
};

export function CustomerForm({
  onAdded,
  heading = "Add a customer",
  editing,
  onCancel,
}: {
  /**
   * Called once the server has the buyer, so the caller can refresh its list. The
   * message is handed up because a caller that closes this card on success would
   * otherwise unmount the confirmation with it, and the save would look like nothing
   * happened.
   */
  onAdded?: (result: unknown, message: string) => void;
  heading?: string;
  /** When set, the form changes the buyer rather than making a new one. */
  editing?: EditableCustomer;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [gstin, setGstin] = useState(editing?.gstin ?? "");
  const [stateCode, setStateCode] = useState(editing?.stateCode ?? "");
  const [billingAddress, setBillingAddress] = useState(editing?.billingAddress ?? "");
  const [shippingAddress, setShippingAddress] = useState(editing?.shippingAddress ?? "");
  const [contactInfo, setContactInfo] = useState(editing?.contactInfo ?? "");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const typed = gstin.trim().toUpperCase();
  const gstinLooksRight = typed === "" || GSTIN_PATTERN.test(typed);
  // Read the state off the GSTIN rather than making them pick it twice.
  const gstinState = GSTIN_PATTERN.test(typed) ? typed.slice(0, 2) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setError("");
    if (!name.trim()) return setError("A customer needs a name");
    if (!gstinLooksRight) {
      return setError(
        `"${typed}" is not a GSTIN. It is 15 characters, like 08AAUFV3603N1ZH — ` +
          `or leave it blank if they are not registered.`,
      );
    }
    setBusy(true);
    try {
      // Editing sends every field, empty string included: a blank GSTIN on an edit
      // means "clear it", which is different from not mentioning it.
      const body = editing
        ? {
            name: name.trim(),
            gstin: typed,
            stateCode: gstinState ?? stateCode,
            billingAddress: billingAddress.trim(),
            shippingAddress: shippingAddress.trim(),
            contactInfo: contactInfo.trim(),
          }
        : {
            name: name.trim(),
            gstin: typed || undefined,
            stateCode: gstinState ?? stateCode ?? undefined,
            billingAddress: billingAddress.trim() || undefined,
            shippingAddress: shippingAddress.trim() || undefined,
            contactInfo: contactInfo.trim() || undefined,
          };
      const result = await apiFetch(
        editing ? `/api/v1/customers/${editing.id}` : "/api/v1/customers",
        {
          method: editing ? "PATCH" : "POST",
          label: editing ? `Update ${name.trim()}` : `New customer ${name.trim()}`,
          body: JSON.stringify(body),
        },
      );
      const message = (
        isQueued(result)
          ? `${name.trim()} saved on this device; they will sync.`
          : editing
            ? typed
              ? `${name.trim()} updated — ${typed}, ${stateName(typed.slice(0, 2)) ?? `state ${typed.slice(0, 2)}`}. Bills from now on use it.`
              : `${name.trim()} updated with no GSTIN, so their bills stay unregistered sales.`
            : typed
              ? `${name.trim()} added — ${typed}, ${stateName(typed.slice(0, 2)) ?? `state ${typed.slice(0, 2)}`}.`
              : `${name.trim()} added with no GSTIN, so their bills are unregistered sales.`
      );
      setNotice(message);
      if (!editing) {
        setName("");
        setGstin("");
        setStateCode("");
        setBillingAddress("");
        setShippingAddress("");
        setContactInfo("");
      }
      onAdded?.(result, message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>{editing ? `Edit ${editing.name}` : heading}</h2>
      {editing && !editing.gstin ? (
        <p className="muted">
          This buyer has no GSTIN, so every bill to them so far has gone out as an
          unregistered local sale. Adding it fixes bills from now on; invoices already
          raised are unchanged.
        </p>
      ) : null}
      {notice ? <p className="hint">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          GSTIN
          <input
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            placeholder="08AAUFV3603N1ZH"
            maxLength={15}
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        {typed && !gstinLooksRight ? (
          <p className="error">
            That is {typed.length} character{typed.length === 1 ? "" : "s"}; a GSTIN is 15.
          </p>
        ) : null}
        {gstinState ? (
          <p className="hint">
            State {gstinState}
            {stateName(gstinState) ? ` · ${stateName(gstinState)}` : ""} — read from the
            GSTIN. Bills to them are{" "}
            {gstinState === "08" ? "CGST + SGST" : "IGST, since the goods leave Rajasthan"}.
          </p>
        ) : null}
        {!typed ? (
          <>
            <label>
              Where they are
              <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                <option value="">Not sure / counter sale</option>
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              No GSTIN means an unregistered buyer: no input credit for them, and the
              bill is a plain one. Enter it later if they produce one.
            </p>
          </>
        ) : null}
        <label>
          Billing address
          <input
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            placeholder="printed on the bill"
          />
        </label>
        <label>
          Site address, if different
          <input
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            placeholder="where the lorry goes"
          />
        </label>
        <label>
          Phone
          <input
            value={contactInfo}
            onChange={(e) => setContactInfo(e.target.value)}
            inputMode="tel"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !gstinLooksRight}>
          {busy ? "Saving…" : editing ? "Save changes" : "Add customer"}
        </button>
        {editing && onCancel ? (
          <>
            {" "}
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : null}
      </form>
    </div>
  );
}
