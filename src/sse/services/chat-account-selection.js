export function mostRecentConnection(connections) {
  return [...connections].sort((a, b) => {
    if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
    if (!a.lastUsedAt) return 1;
    if (!b.lastUsedAt) return -1;
    return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
  })[0];
}

// Selection is read-only; its caller separately owns rotation bookkeeping.
export function chooseChatConnection(connections, settings, provider) {
  const override = (settings.providerStrategies || {})[provider] || {};
  if ((override.fallbackStrategy || settings.fallbackStrategy || "fill-first") !== "round-robin") return connections[0];
  const current = mostRecentConnection(connections);
  if (current?.lastUsedAt && (current.consecutiveUseCount || 0) < (override.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3)) return current;
  return [...connections].sort((a, b) => {
    if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
    if (!a.lastUsedAt) return -1;
    if (!b.lastUsedAt) return 1;
    return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
  })[0];
}
