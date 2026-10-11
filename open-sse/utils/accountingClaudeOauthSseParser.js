import { createAccountingClaudeSseParser } from './accountingClaudeSseParser.js';
import { decloakStreamChunk, cloakClaudeTools } from './claudeCloaking.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { CLAUDE_ACCOUNTING_EVENT as EVENT } from '../config/accountingClaudeSchema.js';

// Raw observer remains the sole validator/usage owner. Only its accepted framed
// events reach this projection; no downstream EOF or estimated terminal repair.
export function createAccountingClaudeOauthParser(original) {
  const toolNameMap = cloakClaudeTools(original).toolNameMap;
  return (onEvent, limits) => createAccountingClaudeSseParser(event => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(event.bytes);
    const lines = text.split(/\r\n|\r|\n/);
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) { onEvent(event); return; }
    let frame;
    try { frame = JSON.parse(data); } catch { throw new Error('Invalid validated Claude OAuth projection'); }
    if (frame.type !== EVENT.BLOCK_START) { onEvent(event); return; }
    // Only names from this request's declared client tools are reversible.
    // Do not suffix-strip unknown or injected decoy tools into another name.
    if (frame.content_block.type !== CLAUDE_BLOCK.TOOL_USE || !toolNameMap?.has(frame.content_block.name)) { onEvent(event); return; }
    const projected = decloakStreamChunk(frame, toolNameMap);
    if (projected === frame) { onEvent(event); return; }
    onEvent({ ...event, bytes: new TextEncoder().encode(`event: ${frame.type}\ndata: ${JSON.stringify(projected)}\n\n`) });
  }, limits);
}
