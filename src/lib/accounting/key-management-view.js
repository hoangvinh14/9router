// Rotated secrets are returned only in the successful rotation response.
export function keyManagementView(key) {
  return key && /^sk-r[0-9a-f]{64}$/.test(key.key) ? { ...key, key: null } : key;
}
