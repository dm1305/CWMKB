import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// CWM knowledge base - Anthropic proxy
//
// Phase 1: the key lives here, not in the browser. Retrieval is still client-side,
// so the browser sends the records block it assembled. Phase 3 moves retrieval here.
//
// Deliberate design points:
//  - The system prompt is read from a secret, NOT accepted from the client.
//    Staff cannot edit the integrity rules by editing the HTML.
//  - The function refuses to run at all if that secret is missing, so it can
//    never quietly answer without the rules in place.
//  - Model and max_tokens are pinned server-side. An authenticated login is not
//    a licence to use the CWM key for arbitrary prompting.

const ALLOWED_MODELS = new Set([
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-haiku-4-5-20251001",
]);
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1400;
const MAX_HISTORY = 8;
const MAX_RECORDS_CHARS = 60000;
const MAX_QUESTION_CHARS = 2000;

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("CWM_ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const systemPrompt = Deno.env.get("CWM_SYSTEM_PROMPT");

  // Fail closed. Without the rules, this function does not answer.
  if (!apiKey) {
    return json({ error: "Server not configured: ANTHROPIC_API_KEY is not set." }, 503);
  }
  if (!systemPrompt || systemPrompt.trim().length < 50) {
    return json({
      error:
        "Server not configured: CWM_SYSTEM_PROMPT is not set. Refusing to answer " +
        "without the integrity rules in place.",
    }, 503);
  }

  let payload: {
    question?: string;
    records?: string;
    history?: Array<{ role: string; content: string }>;
    model?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const question = (payload.question ?? "").trim();
  if (!question) return json({ error: "No question supplied." }, 400);
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ error: "Question too long." }, 400);
  }

  const records = (payload.records ?? "").slice(0, MAX_RECORDS_CHARS);

  const model = payload.model && ALLOWED_MODELS.has(payload.model)
    ? payload.model
    : DEFAULT_MODEL;

  const history = Array.isArray(payload.history)
    ? payload.history
        .filter((m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
        )
        .slice(-MAX_HISTORY)
    : [];

  const userMessage = records
    ? `RECORDS FROM THE KNOWLEDGE BASE\n${records}\n\nQUESTION\n${question}`
    : `RECORDS FROM THE KNOWLEDGE BASE\n(nothing matched this question)\n\nQUESTION\n${question}`;

  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [...history, { role: "user", content: userMessage }],
      }),
    });
  } catch (e) {
    console.error("Upstream fetch failed", e);
    return json({ error: "Could not reach the model." }, 502);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Log detail server-side; do not leak upstream error bodies to the shop floor.
    console.error("Anthropic error", upstream.status, text);
    return json({ error: `Model request failed (${upstream.status}).` }, 502);
  }

  return new Response(text, {
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
  });
});
