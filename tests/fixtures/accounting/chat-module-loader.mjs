import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'node-machine-id' && !context.parentURL?.endsWith('/chat-machine-id-interop.mjs')) {
    return nextResolve(new URL('./chat-machine-id-interop.mjs', import.meta.url).href, context);
  }
  let target;
  if (specifier.startsWith('@/')) target = `${root}src/${specifier.slice(2)}`;
  else if (specifier.startsWith('open-sse/')) target = `${root}${specifier}`;
  if (!target) return nextResolve(specifier, context);
  if (existsSync(target) && statSync(target).isDirectory() && existsSync(`${target}/index.js`)) target += '/index.js';
  if (!existsSync(target) && existsSync(`${target}.js`)) target += '.js';
  return nextResolve(pathToFileURL(target).href, context);
} });
