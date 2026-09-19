import { supabase } from "./supabase";

const FUNCTION_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

let grant: string | null = null;
let expiresAt = 0;

export function isRevenueUnlocked() {
  return Boolean(grant && Date.now() < expiresAt);
}

export function clearRevenueGrant() {
  grant = null;
  expiresAt = 0;
}

export async function createRevenueGrant() {
  const { data, error } = await supabase.functions.invoke("issue-revenue-grant", {
    method: "POST",
  });
  if (error) throw error;
  grant = data.grant;
  expiresAt = new Date(data.expires_at).getTime();
  return data;
}

export async function revokeRevenueGrant() {
  if (!grant) return;
  await supabase.functions.invoke("revoke-revenue-grant", {
    method: "POST",
    headers: { "x-revenue-grant": grant },
  });
  clearRevenueGrant();
}

export async function getRevenueSummary() {
  if (!grant || Date.now() >= expiresAt) {
    clearRevenueGrant();
    throw new Error("収益閲覧認証の有効期限が切れています。");
  }

  const { data, error } = await supabase.functions.invoke("revenue-summary", {
    method: "POST",
    headers: { "x-revenue-grant": grant },
  });
  if (error) {
    clearRevenueGrant();
    throw error;
  }
  return data;
}
