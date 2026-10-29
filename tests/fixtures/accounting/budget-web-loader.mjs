// Test-only source execution; never imported by the shipping application.
import './chat-module-loader.mjs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server' || specifier === 'next/headers') specifier += '.js';
  return nextResolve(specifier, context);
} });
