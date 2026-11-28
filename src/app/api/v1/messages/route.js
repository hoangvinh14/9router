import { handleChat, handleAccountedChatCandidate } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { routeBudgetChat } from '@/lib/accounting/budget-chat-route.js';

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/messages - Claude format (auto convert via handleChat)
 */
export async function POST(request) {
  return routeBudgetChat(request, { initialize: ensureInitialized, handleChat, handleAccountedChatCandidate });
}
