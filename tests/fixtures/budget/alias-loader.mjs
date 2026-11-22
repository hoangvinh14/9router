import { pathToFileURL } from 'node:url';
// Exact reviewed aliases only; no dependency/package fallback or source rewriting.
export function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/dataDir.js') return nextResolve(pathToFileURL('/app/src/lib/dataDir.js').href, context);
  if (specifier === '@/shared/constants/keyAccess.js') return nextResolve(pathToFileURL('/app/src/shared/constants/keyAccess.js').href, context);
  return nextResolve(specifier, context);
}
