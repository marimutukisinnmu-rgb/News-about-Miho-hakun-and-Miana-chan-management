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

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
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
