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
  if (!token) return json({ error: "unauthorized" }, 401)

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return json({ error: "unauthorized" }, 401)

  const { data: aal2, error: aalError } = await userClient.rpc("has_aal2")
  if (aalError || aal2 !== true) return json({ error: "reauthentication_required" }, 403)

  const grant = crypto.randomUUID() + "-" + crypto.randomUUID()
  const tokenHash = await sha256(grant)
  const admin = createClient(url, service)
  await admin.from("revenue_access_grants").delete().eq("user_id", user.id).or("expires_at.lte.now(),revoked_at.not.is.null")
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  const { error } = await admin.from("revenue_access_grants").insert({
    user_id: user.id, token_hash: tokenHash, expires_at: expiresAt.toISOString(),
  })
  if (error) return json({ error: "grant_failed" }, 500)

  await admin.from("audit_logs").insert({
    actor_user_id: user.id, action: "revenue_access_granted",
    target_type: "revenue", details: { expires_in_seconds: 600 },
  })
  return json({ grant, expires_at: expiresAt.toISOString() })
})
