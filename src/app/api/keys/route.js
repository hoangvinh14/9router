import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { authorizeManagement } from "@/lib/auth/managementGuard.js";

const json = (body, options = {}) => NextResponse.json(body, { ...options, headers: { 'Cache-Control': 'no-store' } });

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET(request) {
  const auth = await authorizeManagement(request);
  if (auth.response) return auth.response;
  try {
    const keys = await getApiKeys();
    return json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  const auth = await authorizeManagement(request, { mutation: true });
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId);

    return json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return json({ error: "Failed to create key" }, { status: 500 });
  }
}
