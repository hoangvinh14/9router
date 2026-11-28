"use client";

import { useState } from "react";
import PropTypes from "prop-types";

export default function AnthropicWorkspace({ connectionId }) {
  const [workspaceId, setWorkspaceId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const url = `/api/providers/${encodeURIComponent(connectionId)}/accounting-workspace`;

  async function load(event) {
    if (!event.currentTarget.open || loaded || pending) return;
    setPending(true);
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "error" });
      if (!response.ok) throw new Error();
      const evidence = await response.json();
      setWorkspaceId(evidence.workspaceId ?? "");
      setMessage(evidence.workspaceId ? "" : "No current workspace evidence.");
      setLoaded(true);
    } catch {
      setMessage("Workspace evidence unavailable. Reopen to retry.");
    } finally {
      setPending(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch(url, {
        method: "PUT", cache: "no-store", redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspaceId.trim() }),
      });
      setMessage(response.ok ? "Workspace evidence saved." : "Workspace evidence could not be saved.");
    } catch {
      setMessage("Workspace evidence could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return <details className="mt-2 text-xs" onToggle={load}>
    <summary>Budget accounting workspace</summary>
    <form className="mt-2 space-y-2" onSubmit={save}>
      <p>Verify in Anthropic that the saved API key is scoped to this single workspace. Repeat this after replacing the credential.</p>
      <label className="flex flex-wrap items-center gap-2">Workspace ID
        <input className="rounded border border-border bg-transparent px-2 py-1" value={workspaceId}
          onChange={event => setWorkspaceId(event.target.value)} required pattern="wrkspc_[A-Za-z0-9]{1,128}" />
      </label>
      <button className="text-primary underline disabled:opacity-50" disabled={pending || !loaded} type="submit">
        Save verified workspace
      </button>
      <p role="status">{message}</p>
    </form>
  </details>;
}

AnthropicWorkspace.propTypes = { connectionId: PropTypes.string.isRequired };
