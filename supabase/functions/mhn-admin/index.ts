import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";

const ALLOWED_ORIGINS = new Set([
  "https://marimutukisinnmu-rgb.github.io",
]);
const MAX_BODY_BYTES = 12_000;
const COMMENT_FIELDS = "id, nickname, message, source_page, requester_user_id, status, internal_note, submitted_at, reviewed_at, contact_email, html_review_status, html_reviewed_by, html_reviewed_at, html_review_note";

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(origin: string, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readBodyLimited(req: Request): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size < 0 || size > MAX_BODY_BYTES) return null;
  }
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return jsonResponse(origin, { error: "method_not_allowed" }, 405);

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse(origin, { error: "content_type_must_be_json" }, 415);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse(origin, { error: "unauthorized" }, 401);

  const rawBody = await readBodyLimited(req);
  if (rawBody === null) return jsonResponse(origin, { error: "request_too_large_or_invalid_encoding" }, 413);

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(origin, { error: "invalid_request" }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(origin, { error: "invalid_json" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(origin, { error: "temporarily_unavailable" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Edge gateway JWT verification is disabled for publishable-key clients.
  // Validate the user's access token against Supabase Auth here instead.
  const { data: authData, error: authError } = await admin.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return jsonResponse(origin, { error: "unauthorized" }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    return jsonResponse(origin, { error: "authorization_check_failed" }, 503);
  }
  if (!profile || profile.role !== "admin") {
    return jsonResponse(origin, { error: "admin_required" }, 403);
  }

  if (body.action === "list") {
    const requestedStatus = body.status ?? "all";
    if (!["all", "new", "reviewed", "archived"].includes(String(requestedStatus))) {
      return jsonResponse(origin, { error: "invalid_status" }, 400);
    }

    let query = admin.from("mhn_private_comments")
      .select(COMMENT_FIELDS)
      .order("submitted_at", { ascending: false })
      .limit(100);
    if (requestedStatus !== "all") query = query.eq("status", requestedStatus);

    const [commentsResult, allCount, newCount, reviewedCount, archivedCount] = await Promise.all([
      query,
      admin.from("mhn_private_comments").select("id", { count: "exact", head: true }),
      admin.from("mhn_private_comments").select("id", { count: "exact", head: true }).eq("status", "new"),
      admin.from("mhn_private_comments").select("id", { count: "exact", head: true }).eq("status", "reviewed"),
      admin.from("mhn_private_comments").select("id", { count: "exact", head: true }).eq("status", "archived"),
    ]);

    if (commentsResult.error || allCount.error || newCount.error || reviewedCount.error || archivedCount.error) {
      return jsonResponse(origin, { error: "database_read_failed" }, 500);
    }

    return jsonResponse(origin, {
      ok: true,
      comments: commentsResult.data ?? [],
      counts: {
        all: allCount.count ?? 0,
        new: newCount.count ?? 0,
        reviewed: reviewedCount.count ?? 0,
        archived: archivedCount.count ?? 0,
      },
    });
  }

  if (body.action === "html_review") {
    if (!isUuid(body.id)) return jsonResponse(origin, { error: "invalid_comment_id" }, 400);
    const decision = body.decision;
    if (!["pending", "approved", "rejected"].includes(String(decision))) {
      return jsonResponse(origin, { error: "invalid_html_review_decision" }, 400);
    }
    const note = body.review_note ?? "";
    if (typeof note !== "string" || Array.from(note).length > 2000) {
      return jsonResponse(origin, { error: "invalid_review_note" }, 400);
    }

    const { data: before, error: beforeError } = await admin
      .from("mhn_private_comments")
      .select("id, message, html_review_status")
      .eq("id", body.id)
      .maybeSingle();
    if (beforeError) return jsonResponse(origin, { error: "database_read_failed" }, 500);
    if (!before) return jsonResponse(origin, { error: "comment_not_found" }, 404);
    if (typeof before.message !== "string" || !before.message.startsWith("[HTML制作依頼]")) {
      return jsonResponse(origin, { error: "not_html_request" }, 400);
    }

    const updates = {
      html_review_status: decision,
      html_reviewed_by: decision === "pending" ? null : authData.user.id,
      html_reviewed_at: decision === "pending" ? null : new Date().toISOString(),
      html_review_note: note.trim() || null,
    };
    const { data: updated, error: updateError } = await admin
      .from("mhn_private_comments")
      .update(updates)
      .eq("id", body.id)
      .select(COMMENT_FIELDS)
      .single();
    if (updateError || !updated) return jsonResponse(origin, { error: "database_update_failed" }, 500);

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_user_id: authData.user.id,
      action: "mhn_html_request_reviewed",
      target_type: "mhn_private_comment",
      target_id: body.id,
      details: {
        decision_before: before.html_review_status ?? "pending",
        decision_after: decision,
        note_present: Boolean(note.trim()),
      },
    });

    return jsonResponse(origin, { ok: true, comment: updated, audit_logged: !auditError });
  }

  if (body.action === "update") {
    if (!isUuid(body.id)) return jsonResponse(origin, { error: "invalid_comment_id" }, 400);

    const updates: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      if (!["new", "reviewed", "archived"].includes(String(body.status))) {
        return jsonResponse(origin, { error: "invalid_status" }, 400);
      }
      updates.status = body.status;
      if (body.status === "reviewed") updates.reviewed_at = new Date().toISOString();
      if (body.status === "new") updates.reviewed_at = null;
    }

    if (Object.prototype.hasOwnProperty.call(body, "internal_note")) {
      if (typeof body.internal_note !== "string" || Array.from(body.internal_note).length > 2000) {
        return jsonResponse(origin, { error: "invalid_internal_note" }, 400);
      }
      updates.internal_note = body.internal_note.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse(origin, { error: "nothing_to_update" }, 400);
    }

    const { data: before, error: beforeError } = await admin
      .from("mhn_private_comments")
      .select("id, status")
      .eq("id", body.id)
      .maybeSingle();
    if (beforeError) return jsonResponse(origin, { error: "database_read_failed" }, 500);
    if (!before) return jsonResponse(origin, { error: "comment_not_found" }, 404);

    const { data: updated, error: updateError } = await admin
      .from("mhn_private_comments")
      .update(updates)
      .eq("id", body.id)
      .select(COMMENT_FIELDS)
      .single();
    if (updateError || !updated) return jsonResponse(origin, { error: "database_update_failed" }, 500);

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_user_id: authData.user.id,
      action: "mhn_private_comment_updated",
      target_type: "mhn_private_comment",
      target_id: body.id,
      details: {
        status_before: before.status,
        status_after: updated.status,
        internal_note_changed: Object.prototype.hasOwnProperty.call(updates, "internal_note"),
      },
    });

    return jsonResponse(origin, {
      ok: true,
      comment: updated,
      audit_logged: !auditError,
    });
  }

  return jsonResponse(origin, { error: "unknown_action" }, 400);
});
