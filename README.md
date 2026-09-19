# MHN Management

みほはくん＆みあなちゃん（MHN）の管理システム。

## 構成

- Frontend: React + Vite + TypeScript
- Auth / DB: Supabase
- Passkey: Supabase Auth experimental Passkey API
- 重要データ: Supabase Edge Functions経由
- 収益再認証: TOTP MFA
- 収益閲覧グラント: 10分で失効
- ブラウザタブ切り替え: `visibilitychange` で即時ロック + サーバー側グラント失効
- 監査ログ: `public.audit_logs`

## セキュリティ方針

通常ログインと収益閲覧権限を分離する。

収益データはブラウザから `public.revenues` を直接読むのではなく、
`revenue-summary` Edge Functionが短期グラントを検証して取得する。

グラントはランダムなトークンそのものをDBに保存せず、SHA-256ハッシュのみ保存する。

## 環境変数

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

秘密鍵（`SUPABASE_SERVICE_ROLE_KEY` 等）は絶対にフロントエンドへ入れない。

## ローカル起動

```bash
npm install
npm run dev
```

## 重要な認証仕様

1. 通常ログイン
2. 「収益を見る」を押す
3. TOTP MFAで再認証
4. 10分間だけ収益閲覧グラントを発行
5. 別ブラウザタブへ切り替えたら即ロック
6. 10分経過でも自動ロック
7. ログアウト時もグラントを失効

> Passkeyは現在、Supabase Authの実験的機能。Passkeyによる通常ログインと登録を実装し、収益閲覧の再認証は現行SupabaseのMFA/TOTPを使用する。
