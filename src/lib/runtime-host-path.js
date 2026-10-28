import { join } from "node:path";

// Host configuration belongs to the running machine, outside packaged assets.
// Keep the join behind a module boundary so file tracing cannot glob env roots.
export function runtimeHostPath(...segments) {
  return join(...segments);
}
