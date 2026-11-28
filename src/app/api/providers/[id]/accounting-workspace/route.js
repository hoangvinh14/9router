import { requireAccountingAdmin } from '@/lib/accounting/management-auth.js';
import { boundedAccountingJson } from '@/lib/accounting/management-request.js';
import { inspectAnthropicWorkspace, saveAnthropicWorkspace } from '@/lib/accounting/anthropic-workspace.js';
import { getAccountingAdapter } from '@/lib/db/driver.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const unavailable = () => json({ error: 'Anthropic workspace evidence unavailable' }, 503);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);

export async function GET(request, { params }) {
  const denied = await requireAccountingAdmin(request);
  if (denied) return denied;
  const { id } = await params;
  if (!validId(id)) return json({ error: 'Invalid connection ID' }, 400);
  try { return json(inspectAnthropicWorkspace(await getAccountingAdapter(), id)); }
  catch { return unavailable(); }
}

export async function PUT(request, { params }) {
  const denied = await requireAccountingAdmin(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (!validId(id)) return json({ error: 'Invalid connection ID' }, 400);
  let body;
  try { body = await boundedAccountingJson(request); }
  catch (error) { return json({ error: 'Invalid workspace request' }, error.status === 413 ? 413 : 400); }
  if (!body || Object.keys(body).join() !== 'workspaceId' ||
      typeof body.workspaceId !== 'string' || !/^wrkspc_[A-Za-z0-9]{1,128}(?![\s\S])/.test(body.workspaceId)) {
    return json({ error: 'Enter a valid Anthropic workspace ID' }, 400);
  }
  try { return json(saveAnthropicWorkspace(await getAccountingAdapter(), id, body.workspaceId)); }
  catch { return unavailable(); }
}
