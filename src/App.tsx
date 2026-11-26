import { useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import {
  clearRevenueGrant,
  createRevenueGrant,
  getRevenueSummary,
  isRevenueUnlocked,
  revokeRevenueGrant,
} from "./lib/revenueAccess";
import "./styles.css";

type RevenueRow = {
  id: string;
  source: string;
  source_name: string | null;
  occurred_at: string;
  amount_yen: number;
  mhn_share_yen: number;
  status: string;
  note: string | null;
};

type HtmlRequest = {
  id: string; nickname: string | null; message: string; source_page: string; requester_user_id: string | null; submitted_at: string;
  html_review_status: "pending" | "approved" | "rejected"; html_review_note: string | null; html_reviewed_at: string | null;
};
type HtmlFinding = { code: string; label: string; count: number };
type HtmlScan = { scanner: string; findings: HtmlFinding[]; finding_count: number; manual_review_required: boolean; limitations: string[] };

function HtmlReviewPanel() {
  const [items, setItems] = useState<HtmlRequest[]>([]);
  const [selected, setSelected] = useState<HtmlRequest | null>(null);
  const [scan, setScan] = useState<HtmlScan | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [note, setNote] = useState("");
  const [panelError, setPanelError] = useState("");
  const [panelMessage, setPanelMessage] = useState("");

  async function callAdmin(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke("mhn-admin", { body });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error ?? "管理APIでエラーが発生しました。");
    return data;
  }

  async function loadRequests() {
    setLoadingItems(true);
    setPanelError("");
    try {
      const data = await callAdmin({ action: "list", status: "all" });
      const htmlItems = (data.comments as HtmlRequest[]).filter((item) =>
        typeof item.message === "string" && item.message.startsWith("[HTML制作依頼]")
      );
      setItems(htmlItems);
      setSelected((current) => current ? (htmlItems.find((item) => item.id === current.id) ?? current) : null);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "依頼一覧を取得できませんでした。");
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => { void loadRequests(); }, []);
  const visibleItems = items.filter((item) => filter === "all" || item.html_review_status === filter);

  async function selectRequest(item: HtmlRequest) {
    setSelected(item);
    setScan(null);
    setNote(item.html_review_note ?? "");
    setPanelError("");
    setPanelMessage("");
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("mhn-html-review", { body: { id: item.id } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "検査に失敗しました。");
      setScan(data as HtmlScan);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "検査に失敗しました。");
    } finally {
      setScanning(false);
    }
  }

  async function decide(decision: "approved" | "rejected" | "pending") {
    if (!selected) return;
    const prompt = decision === "approved" ? "このHTML制作依頼を承認しますか？" :
      decision === "rejected" ? "このHTML制作依頼を却下しますか？" : "この依頼を未判断に戻しますか？";
    if (!window.confirm(prompt)) return;
    setSaving(true); setPanelError(""); setPanelMessage("");
    try {
      await callAdmin({ action: "html_review", id: selected.id, decision, review_note: note });
      const label = decision === "approved" ? "承認" : decision === "rejected" ? "却下" : "保留";
      setPanelMessage(label + "を記録しました。");
      const updated = { ...selected, html_review_status: decision, html_review_note: note };
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === selected.id ? updated : item));
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "審査結果を保存できませんでした。");
    } finally { setSaving(false); }
  }

  return (
    <section className="card html-review-panel">
      <div className="row html-review-heading">
        <div><h2>🧾 HTML制作依頼の審査</h2><p className="muted">検査結果を確認し、最終判断は管理者が行います。</p></div>
        <button onClick={() => void loadRequests()} disabled={loadingItems}>更新</button>
      </div>
      <div className="html-review-filters">
        {(["pending", "approved", "rejected", "all"] as const).map((value) => (
          <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {value === "pending" ? "未判断" : value === "approved" ? "承認済み" : value === "rejected" ? "却下" : "すべて"}
            <span>{value === "all" ? items.length : items.filter((item) => item.html_review_status === value).length}</span>
          </button>
        ))}
      </div>
      <div className="html-review-layout">
        <div className="html-request-list">
          {loadingItems ? <p className="muted">依頼を読み込み中…</p> : visibleItems.length === 0 ? <p className="muted">該当する依頼はありません。</p> : visibleItems.map((item) => (
            <button key={item.id} className={selected?.id === item.id ? "html-request active" : "html-request"} onClick={() => void selectRequest(item)}>
              <span className="row"><strong>{item.nickname || "匿名"}</strong><span className={"review-state " + item.html_review_status}>{item.html_review_status === "pending" ? "未判断" : item.html_review_status === "approved" ? "承認済み" : "却下"}</span></span>
              <small>{new Date(item.submitted_at).toLocaleString("ja-JP")}</small>
              <small>依頼者ID: {item.requester_user_id ?? "未紐付け"}</small>
              <small>対象ページ: {item.source_page || "不明"}</small>
              <span className="request-preview">{item.message.slice(0, 100).replace("[HTML制作依頼]", "").trim() || "HTML制作依頼"}</span>
            </button>
          ))}
        </div>
        <div className="html-request-detail">
          {!selected ? <p className="muted">左の一覧から依頼を選択してください。</p> : <>
            <div className="row"><h3>依頼内容</h3><span className={"review-state " + selected.html_review_status}>{selected.html_review_status === "pending" ? "未判断" : selected.html_review_status === "approved" ? "承認済み" : "却下"}</span></div>
            
            <div className="muted small">
              <p>依頼者ID: <span className="request-preview">{selected.requester_user_id ?? "未紐付け"}</span></p>
              <p>対象ページ: <span className="request-preview">{selected.source_page || "不明"}</span></p>
            </div>
            <pre className="request-content">{selected.message}</pre>
            <h3>個人情報・秘密情報候補の検査</h3>
            {scanning ? <p className="muted">検査中…</p> : scan ? <>
              <p><strong>{scan.finding_count}件</strong>の候補（{scan.scanner}）</p>
              {scan.findings.length ? <ul className="finding-list">{scan.findings.map((finding) => <li key={finding.code}>{finding.label}：{finding.count}件</li>)}</ul> : <p className="muted">既知パターンの候補は検出されませんでした。</p>}
              <ul className="limitation-list">{scan.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
            </> : <p className="muted">検査結果を取得できませんでした。</p>}
            <label className="review-note-label">審査メモ（任意）</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="確認事項や修正依頼など" />
            <div className="review-actions">
              <button onClick={() => void decide("pending")} disabled={saving}>保留</button>
              <button className="reject-button" onClick={() => void decide("rejected")} disabled={saving}>NG・却下</button>
              <button className="primary" onClick={() => void decide("approved")} disabled={saving}>OK・承認</button>
            </div>
            <p className="muted small">OKで依頼を承認します。実際の自動公開は、公開先と生成・デプロイ処理の接続後に有効になります。</p>
          </>}
        </div>
      </div>
      {panelError && <p className="error">{panelError}</p>}
      {panelMessage && <p className="success-text">{panelMessage}</p>}
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginMode, setLoginMode] = useState<"password" | "passkey">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showReauth, setShowReauth] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [revenues, setRevenues] = useState<RevenueRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [unlockedUntil, setUnlockedUntil] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        clearRevenueGrant();
        setRevenues([]);
        setTotal(null);
      }
    });

    const onVisibility = () => {
      if (document.hidden) {
        void revokeRevenueGrant();
        setShowReauth(false);
        setRevenues([]);
        setTotal(null);
        setUnlockedUntil(null);
        setMessage("別タブへ切り替えたため、収益情報をロックしました。");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      listener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setAdminUserId(null);

    if (!session) {
      return () => { active = false; };
    }

    void supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setAdminUserId(!error && data?.role === "admin" ? session.user.id : null);
      })
      .catch(() => {
        if (!active) return;
        setAdminUserId(null);
      });

    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isRevenueUnlocked()) {
        setRevenues([]);
        setTotal(null);
        setUnlockedUntil(null);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!unlockedUntil) return 0;
    return Math.max(0, Math.ceil((unlockedUntil - Date.now()) / 1000));
  }, [unlockedUntil]);

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  async function signInPasskey() {
    setError("");
    const { error } = await supabase.auth.signInWithPasskey();
    if (error) setError(error.message);
  }

  async function registerPasskey() {
    setError("");
    const { error } = await supabase.auth.registerPasskey();
    if (error) setError(error.message);
    else setMessage("Passkeyを登録しました。");
  }

  async function startRevenueReauth() {
    setError("");
    setMessage("");
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setError(error.message);
      return;
    }
    const verified = data.totp?.filter((f) => f.status === "verified") ?? [];
    if (!verified.length) {
      setError("収益閲覧にはTOTP MFAの登録が必要です。");
      return;
    }
    const selected = verified[0];
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: selected.id,
    });
    if (challengeError) {
      setError(challengeError.message);
      return;
    }
    setFactorId(selected.id);
    setChallengeId(challenge.id);
    setOtp("");
    setShowReauth(true);
  }

  async function verifyRevenueReauth(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: otp,
    });
    if (error) {
      setError(error.message);
      return;
    }

    try {
      const data = await createRevenueGrant();
      setUnlockedUntil(new Date(data.expires_at).getTime());
      setShowReauth(false);
      await loadRevenue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "収益認証に失敗しました。");
    }
  }

  async function loadRevenue() {
    try {
      const data = await getRevenueSummary();
      setRevenues(data.rows);
      setTotal(data.total_mhn_share_yen);
      setUnlockedUntil(new Date(data.expires_at).getTime());
    } catch (err) {
      clearRevenueGrant();
      setRevenues([]);
      setTotal(null);
      setUnlockedUntil(null);
      setError(err instanceof Error ? err.message : "収益データを取得できませんでした。");
    }
  }

  async function lockRevenue() {
    await revokeRevenueGrant();
    setRevenues([]);
    setTotal(null);
    setUnlockedUntil(null);
    setMessage("収益情報をロックしました。");
  }

  async function signOut() {
    await revokeRevenueGrant();
    await supabase.auth.signOut();
  }

  if (loading) return <main className="center">読み込み中…</main>;

  if (!session) {
    return (
      <main className="shell center">
        <section className="card auth-card">
          <div className="brand">MHN</div>
          <h1>Management</h1>
          <p className="muted">みほはくん＆みあなちゃん 管理システム</p>

          <div className="segmented">
            <button className={loginMode === "password" ? "active" : ""} onClick={() => setLoginMode("password")}>メール / パスワード</button>
            <button className={loginMode === "passkey" ? "active" : ""} onClick={() => setLoginMode("passkey")}>Passkey</button>
          </div>

          {loginMode === "password" ? (
            <form onSubmit={signInPassword} className="stack">
              <input type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button className="primary" type="submit">ログイン</button>
            </form>
          ) : (
            <button className="primary wide" onClick={signInPasskey}>Passkeyでログイン</button>
          )}

          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">MHN</div>
          <strong>Management</strong>
        </div>
        <div className="top-actions">
          <span className="muted">{session.user.email}</span>
          <button onClick={signOut}>ログアウト</button>
        </div>
      </header>

      {session && adminUserId === session.user.id && <HtmlReviewPanel />}

      <section className="grid">
        <article className="card">
          <h2>🔐 セキュリティ</h2>
          <p>通常ログインと重要データの再認証を分離しています。</p>
          <button onClick={registerPasskey}>この端末にPasskeyを登録</button>
        </article>

        <article className="card sensitive">
          <div className="row">
            <div>
              <h2>💰 収益を見る</h2>
              <p className="muted">再認証後、最大10分だけ閲覧できます。</p>
            </div>
            {unlockedUntil ? <span className="badge">解除中</span> : <span className="badge locked">ロック中</span>}
          </div>

          {!unlockedUntil ? (
            <button className="primary wide" onClick={startRevenueReauth}>🔐 再認証して収益を見る</button>
          ) : (
            <>
              <div className="total">¥{(total ?? 0).toLocaleString("ja-JP")}</div>
              <p className="muted">残り約 {remainingSeconds} 秒</p>
              <button onClick={lockRevenue}>🔒 今すぐロック</button>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>発生日</th><th>収益元</th><th>金額</th><th>MHN分</th><th>状態</th></tr></thead>
                  <tbody>
                    {revenues.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.occurred_at).toLocaleDateString("ja-JP")}</td>
                        <td>{row.source_name || row.source}</td>
                        <td>¥{Number(row.amount_yen).toLocaleString("ja-JP")}</td>
                        <td>¥{Number(row.mhn_share_yen).toLocaleString("ja-JP")}</td>
                        <td>{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </article>
      </section>

      {showReauth && (
        <div className="modal-backdrop">
          <form className="card modal" onSubmit={verifyRevenueReauth}>
            <h2>🔐 収益閲覧の再認証</h2>
            <p>認証アプリに表示された6桁のコードを入力してください。</p>
            <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus required />
            <div className="row">
              <button type="button" onClick={() => setShowReauth(false)}>キャンセル</button>
              <button className="primary" type="submit">認証する</button>
            </div>
          </form>
        </div>
      )}

      {message && <div className="toast">{message}</div>}
      {error && <div className="toast error">{error}</div>}
    </main>
  );
}
