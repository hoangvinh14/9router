"use client";

import { useId, useState } from "react";
import PropTypes from "prop-types";
import { nanoUsdToDecimal } from "@/lib/pricing/decimalMoney.js";

import { loadAccountingStatus, rotateBudgetKey } from "./accountingStatusClient";
import useAccountingSnapshot from "../../useAccountingSnapshot";

const displayUsd = amount => amount === null ? "Unlimited" : nanoUsdToDecimal(amount);

function StatusSnapshot({ keyId, onRotated }) {
  const { state, refresh } = useAccountingSnapshot(keyId, loadAccountingStatus);
  const value = state.value;
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState(null);
  const [rotationError, setRotationError] = useState("");
  async function rotate() {
    if (pending || !window.confirm("Rotate this API key? The old key will stop working immediately.")) return;
    setPending(true);
    setRotationError("");
    try {
      const { key } = await rotateBudgetKey(keyId, value.version);
      setSecret(key);
      if (!key) setRotationError("Rotation committed. Confirm a new rotation to obtain a fresh key.");
      onRotated?.(keyId);
    } catch (error) {
      setRotationError(error.message);
    } finally {
      setPending(false);
      refresh();
    }
  }
  return (
    <div className="mt-2 rounded border border-border p-3 text-xs text-text-muted" aria-busy={state.loading}>
      <p>Recorded policy and retirement status.</p>
      <div className="mt-2 min-h-6" role="status" aria-live="polite">
        {state.loading && <p>Loading accounting status…</p>}
        {state.error && <p>{state.error}</p>}
        {value && (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-1 break-words">
              <div><dt className="inline font-medium">Policy state: </dt><dd className="inline">{value.lifecycle}</dd></div>
              <div><dt className="inline font-medium">Policy version: </dt><dd className="inline">{value.version}</dd></div>
              <div><dt className="inline font-medium">Binding generation: </dt><dd className="inline">{value.bindingGeneration}</dd></div>
              <div><dt className="inline font-medium">Weekly limit (USD): </dt><dd className="inline">{displayUsd(value.weekly)}</dd></div>
              <div><dt className="inline font-medium">Monthly limit (USD): </dt><dd className="inline">{displayUsd(value.monthly)}</dd></div>
            </dl>
            {value.retirementEvent ? (
              <div className="mt-2 break-words">
                <p className="font-medium">Recorded retirement event</p>
                <p>Recorded time: <time dateTime={value.retirementEvent.occurredAt}>{value.retirementEvent.occurredAt}</time></p>
                <p>Actor class: {value.retirementEvent.actorClass} (shared authentication class, not an individual).</p>
                <p>Policy version {value.retirementEvent.previousVersion} → {value.retirementEvent.version}.</p>
              </div>
            ) : <p className="mt-2">No recorded retirement event. This does not mean this key was never retired.</p>}
            <p className="mt-2">Not a complete or tamper-proof audit history. Recorded time is not independently trusted chronology. Retired credentials remain stored; retirement is not secret erasure.</p>
          </>
        )}
      </div>
      {value?.lifecycle === "active" && !secret && (
        <button type="button" className="mt-2 mr-3 text-primary underline disabled:opacity-50"
          disabled={pending} onClick={rotate}>Rotate API key</button>
      )}
      {rotationError && <p role="alert" className="mt-2">{rotationError}</p>}
      {secret && (
        <div className="mt-2">
          <p>Copy the new API key now. It is shown once.</p>
          <code className="block break-all select-all">{secret}</code>
          <button type="button" className="mt-2 text-primary underline" onClick={() => setSecret(null)}>Done</button>
        </div>
      )}
      <button type="button" className="mt-2 text-primary underline disabled:opacity-50" disabled={state.loading}
        onClick={refresh}>
        Refresh accounting status
      </button>
    </div>
  );
}

export default function AccountingStatus({ keyId, onRotated }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-2">
      <button type="button" className="text-xs text-primary underline" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>
        {open ? "Hide accounting status" : "Accounting status"}
      </button>
      <div id={panelId}>{open && <StatusSnapshot key={keyId} keyId={keyId} onRotated={onRotated} />}</div>
    </div>
  );
}

StatusSnapshot.propTypes = { keyId: PropTypes.string.isRequired, onRotated: PropTypes.func };
AccountingStatus.propTypes = { keyId: PropTypes.string.isRequired, onRotated: PropTypes.func };
