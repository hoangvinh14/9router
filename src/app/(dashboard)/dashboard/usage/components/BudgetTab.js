"use client";

import { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { CardSkeleton } from "@/shared/components/Loading";
import { loadBudget, loadBudgetKeys } from "../../endpoint/components/accountingStatusClient";
import useAccountingSnapshot from "../../useAccountingSnapshot";
import BudgetDetails, { displayUsd } from "./BudgetDetails";

function budgetStatus(active, state) {
  if (!active) return "Inactive";
  if (state.loading) return "Loading budget…";
  if (state.error || (!state.value?.available && !state.value?.canCreate)) return "Budget unavailable";
  if (state.value.canCreate) return "Not set";
  if (state.value.lifecycle !== "active") return state.value.lifecycle;
  if (state.value.blockedByUnresolvedUsage) return "Unresolved usage";
  if (state.value.periods.some(period => period.remaining === "0")) return "Limit reached";
  return "Active";
}

function BudgetRow({ apiKey, linked }) {
  const row = useRef(null);
  const { state, refresh } = useAccountingSnapshot(apiKey.isActive ? apiKey.id : null, loadBudget);
  const activeBudget = state.value?.available ? state.value : null;
  const status = budgetStatus(apiKey.isActive, state);
  const warning = status === "Unresolved usage" || status === "Limit reached";

  useEffect(() => {
    if (!linked) return;
    row.current.open = true;
    row.current.scrollIntoView({ block: "nearest" });
  }, [linked]);

  return (
    <details ref={row} className="group border-b border-border-subtle last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-surface-2/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:gap-4 sm:px-6">
        <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:col-span-1">
          <span className="min-w-0 break-words font-semibold">{apiKey.name}</span>
          <span className={`rounded-md bg-surface-2 px-2 py-0.5 text-xs ${warning ? "text-danger" : "text-text-muted"}`}>
            {status}
          </span>
        </span>
        {["weekly", "monthly"].map((name) => {
          const period = activeBudget?.periods.find(item => item.name === name);
          return (
            <span key={name} className="min-w-0">
              <span className="block text-xs capitalize text-text-muted">{name} used / limit</span>
              <span className="block break-words text-sm font-medium tabular-nums">
                {period ? `$${displayUsd(period.spent)} / ${period.limit === null ? "Unlimited" : `$${displayUsd(period.limit)}`}` : "—"}
              </span>
            </span>
          );
        })}
        <span aria-hidden="true" className="material-symbols-outlined col-start-3 row-start-1 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none sm:col-start-4">
          expand_more
        </span>
      </summary>
      <div className="border-t border-border-subtle bg-bg px-4 pb-4 pt-2 sm:px-6">
        {apiKey.isActive ? (
          <BudgetDetails keyId={apiKey.id} state={state} refresh={refresh} />
        ) : (
          <p className="py-2 text-sm text-text-muted">This API key is inactive.</p>
        )}
      </div>
    </details>
  );
}

const apiKeyType = PropTypes.shape({
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  isActive: PropTypes.bool.isRequired,
});
BudgetRow.propTypes = { apiKey: apiKeyType.isRequired, linked: PropTypes.bool.isRequired };

export default function BudgetTab({ keyId }) {
  const { state, refresh } = useAccountingSnapshot("budget-keys", loadBudgetKeys);

  if (state.loading) return <CardSkeleton />;
  if (state.error) {
    return (
      <Card>
        <p role="alert" className="text-sm text-text-muted">{state.error}</p>
        <button type="button" onClick={refresh} className="mt-2 text-sm text-primary underline">Retry</button>
      </Card>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="API key budgets">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">API keys</h2>
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted">
          {state.value.length} {state.value.length === 1 ? "key" : "keys"}
        </span>
      </div>
      {keyId && !state.value.some(key => key.id === keyId) && (
        <p role="status" className="text-sm text-text-muted">The linked API key is no longer available.</p>
      )}
      <Card padding="none">
        {state.value.length ? state.value.map(apiKey => (
          <BudgetRow key={apiKey.id} apiKey={apiKey} linked={apiKey.id === keyId} />
        )) : <p className="p-8 text-center text-sm text-text-muted">No API keys found.</p>}
      </Card>
    </section>
  );
}

BudgetTab.propTypes = { keyId: PropTypes.string };
