import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
describe('Tailwind application source boundary', () => {
  it('resolves the declared scan scope to src, not task logs or repository artifacts', () => {
    const file = path.join(root, 'src/app/globals.css');
    const css = fs.readFileSync(file, 'utf8');
    const source = css.match(/@import\s+"tailwindcss"\s+source\("([^"]+)"\)/)?.[1];
    expect(source).toBeDefined();
    expect(path.resolve(path.dirname(file), source)).toBe(path.join(root, 'src'));
  });
});
