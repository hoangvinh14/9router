import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { authorizeManagement } from "@/lib/auth/managementGuard.js";

const json = (body, options = {}) => NextResponse.json(body, { ...options, headers: { 'Cache-Control': 'no-store' } });

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  const auth = await authorizeManagement(request);
  if (auth.response) return auth.response;
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return json({ error: "Key not found" }, { status: 404 });
    }
    return json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  const auth = await authorizeManagement(request, { mutation: true });
  if (auth.response) return auth.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, access } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }

    const updated = await updateApiKey(id, updateData);

    return json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  const auth = await authorizeManagement(request, { mutation: true });
  if (auth.response) return auth.response;
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return json({ error: "Key not found" }, { status: 404 });
    }

    return json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return json({ error: "Failed to delete key" }, { status: 500 });
  }
}
