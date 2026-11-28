import { useEffect, useState } from "react";

export default function useAccountingSnapshot(keyId, load) {
  const [snapshot, setState] = useState(null);
  const state = snapshot?.keyId === keyId ? snapshot : { loading: true, value: null, error: null };
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!keyId) return;
    const controller = new AbortController();
    let current = true;
    load(keyId, { signal: controller.signal }).then(
      value => { if (current) setState({ keyId, loading: false, value, error: null }); },
      error => { if (current) setState({ keyId, loading: false, value: null, error: error.message }); },
    );
    return () => { current = false; controller.abort(); };
  }, [keyId, load, revision]);
  function refresh() {
    setState({ keyId, loading: true, value: null, error: null });
    setRevision(n => n + 1);
  }
  return { state, refresh };
}
