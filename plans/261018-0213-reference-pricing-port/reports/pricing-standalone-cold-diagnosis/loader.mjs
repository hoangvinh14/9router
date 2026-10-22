import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = '/home/gmo/projects/9router';
export async function resolve(specifier, context, nextResolve) {
  let target;
  if (specifier.startsWith('@/')) target = path.join(repo, 'src', specifier.slice(2));
  else if (specifier.startsWith('open-sse/')) target = path.join(repo, specifier);
  if (target) {
    if (!fs.existsSync(target) && fs.existsSync(target + '.js')) target += '.js';
    if (!target.startsWith(repo + '/')) throw new Error('Alias escaped repository');
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  const result = await nextResolve(specifier, context);
  if (result.url.startsWith('file:')) {
    const file = fileURLToPath(result.url);
    if (!file.startsWith(repo + '/') && !file.startsWith('/tmp/9router-pricing-node-diag-6k4q4nez/')) throw new Error('Diagnostic resolution escaped inputs');
  }
  return result;
}
