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

export function CustomerForm({
  onAdded,
  heading = "Add a customer",
}: {
  /** Called once the server has the buyer, so the caller can refresh its list. */
  onAdded?: (result: unknown) => void;
  heading?: string;
}) {
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [contactInfo, setContactInfo] = useState("");
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
      const result = await apiFetch("/api/v1/customers", {
        method: "POST",
        label: `New customer ${name.trim()}`,
        body: JSON.stringify({
          name: name.trim(),
          gstin: typed || undefined,
          stateCode: gstinState ?? stateCode ?? undefined,
          billingAddress: billingAddress.trim() || undefined,
          shippingAddress: shippingAddress.trim() || undefined,
          contactInfo: contactInfo.trim() || undefined,
        }),
      });
      setNotice(
        isQueued(result)
          ? `${name.trim()} saved on this device; they will sync.`
          : typed
            ? `${name.trim()} added — ${typed}, ${stateName(typed.slice(0, 2)) ?? `state ${typed.slice(0, 2)}`}.`
            : `${name.trim()} added with no GSTIN, so their bills are unregistered sales.`,
      );
      setName("");
      setGstin("");
      setStateCode("");
      setBillingAddress("");
      setShippingAddress("");
      setContactInfo("");
      onAdded?.(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>{heading}</h2>
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
          {busy ? "Saving…" : "Add customer"}
        </button>
      </form>
    </div>
  );
}
