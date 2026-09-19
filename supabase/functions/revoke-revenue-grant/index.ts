import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-revenue-grant",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function bearer(req: Request) {
  const value = req.headers.get("Authorization") ?? ""
  return value.startsWith("Bearer ") ? value.slice(7) : null
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const token = bearer(req)
  const grant = req.headers.get("x-revenue-grant")
  if (!token || !grant) return json({ error: "unauthorized" }, 401)

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: "unauthorized" }, 401)

  const admin = createClient(url, service)
  const tokenHash = await sha256(grant)
  await admin.from("revenue_access_grants").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id).eq("token_hash", tokenHash)

  await admin.from("audit_logs").insert({
    actor_user_id: user.id, action: "revenue_access_revoked",
    target_type: "revenue", details: { reason: "tab_hidden_or_manual_lock" },
  })
  return json({ ok: true })
})
