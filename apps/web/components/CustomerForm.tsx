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

/** GST state codes used in customer and supplier details. */
const STATES: Array<{code:string;name:string}> = [
  {
    "code": "01",
    "name": "Jammu and Kashmir"
  },
  {
    "code": "02",
    "name": "Himachal Pradesh"
  },
  {
    "code": "03",
    "name": "Punjab"
  },
  {
    "code": "04",
    "name": "Chandigarh"
  },
  {
    "code": "05",
    "name": "Uttarakhand"
  },
  {
    "code": "06",
    "name": "Haryana"
  },
  {
    "code": "07",
    "name": "Delhi"
  },
  {
    "code": "08",
    "name": "Rajasthan"
  },
  {
    "code": "09",
    "name": "Uttar Pradesh"
  },
  {
    "code": "10",
    "name": "Bihar"
  },
  {
    "code": "11",
    "name": "Sikkim"
  },
  {
    "code": "12",
    "name": "Arunachal Pradesh"
  },
  {
    "code": "13",
    "name": "Nagaland"
  },
  {
    "code": "14",
    "name": "Manipur"
  },
  {
    "code": "15",
    "name": "Mizoram"
  },
  {
    "code": "16",
    "name": "Tripura"
  },
  {
    "code": "17",
    "name": "Meghalaya"
  },
  {
    "code": "18",
    "name": "Assam"
  },
  {
    "code": "19",
    "name": "West Bengal"
  },
  {
    "code": "20",
    "name": "Jharkhand"
  },
  {
    "code": "21",
    "name": "Odisha"
  },
  {
    "code": "22",
    "name": "Chhattisgarh"
  },
  {
    "code": "23",
    "name": "Madhya Pradesh"
  },
  {
    "code": "24",
    "name": "Gujarat"
  },
  {
    "code": "26",
    "name": "Dadra and Nagar Haveli and Daman and Diu"
  },
  {
    "code": "27",
    "name": "Maharashtra"
  },
  {
    "code": "29",
    "name": "Karnataka"
  },
  {
    "code": "30",
    "name": "Goa"
  },
  {
    "code": "31",
    "name": "Lakshadweep"
  },
  {
    "code": "32",
    "name": "Kerala"
  },
  {
    "code": "33",
    "name": "Tamil Nadu"
  },
  {
    "code": "34",
    "name": "Puducherry"
  },
  {
    "code": "35",
    "name": "Andaman and Nicobar Islands"
  },
  {
    "code": "36",
    "name": "Telangana"
  },
  {
    "code": "37",
    "name": "Andhra Pradesh"
  },
  {
    "code": "38",
    "name": "Ladakh"
  }
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
  kind = "customer",
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
  kind?: "customer" | "supplier";
}) {
  const basePath = kind === "supplier" ? "/api/v1/inventory/suppliers" : "/api/v1/customers";
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
    if (!name.trim()) return setError(`A ${kind} needs a name`);
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
        editing ? `${basePath}/${editing.id}` : basePath,
        {
          method: editing ? "PATCH" : "POST",
          label: editing ? `Update ${name.trim()}` : `New customer ${name.trim()}`,
          body: JSON.stringify(body),
        },
      );
      const message = kind === "supplier" ? `${name.trim()} ${isQueued(result) ? "saved on this device; it will sync" : editing ? "updated" : "added"}.` : (
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
      {kind === "customer" && editing && !editing.gstin ? (
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
            GSTIN.
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
              {kind === "supplier" ? "Leave GSTIN blank for an unregistered supplier. No GST input credit can be claimed without their GSTIN." : "Leave GSTIN blank for an unregistered buyer or counter sale. Add it later if they provide one."}
            </p>
          </>
        ) : null}
        <label>
          Billing address
          <input
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            placeholder={kind === "supplier" ? "supplier billing address" : "printed on the bill"}
          />
        </label>
        <label>
          {kind === "supplier" ? "Pickup / dispatch address, if different" : "Site address, if different"}
          <input
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            placeholder={kind === "supplier" ? "where the stone is collected" : "where the lorry goes"}
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
          {busy ? "Saving…" : editing ? "Save changes" : kind === "supplier" ? "Add supplier" : "Add customer"}
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
