# FinShinjuku OpenClaw PR Review Bot

GitHub Actionsを使わず、GitHub Appの権限でPRをOpenClawにレビューさせる軽量Botです。

推奨構成は `BOT_MODE=poll` です。Mac miniからGitHub APIへ定期的にアクセスするだけなので、公開URL、受信ポート、トンネルサービスは不要です。

## できること

- polling mode: Mac miniからGitHub APIを定期確認し、新規/更新PRをレビュー
- webhook mode: GitHub App WebhookでPRイベントを受けてレビュー

- OpenClawでPR差分をレビュー
- 品質スコアを0-100で算出
- 95点以上なら `ai-review:merge-ok` ラベル
- 95点未満なら `ai-review:needs-work` ラベル
- PRにレビューコメントを投稿
- Lark/Feishuなどのチャットにレビュー要約を通知

GitHub Actions runnerは使いません。

## 対象リポジトリ

このBotを現在の全リポジトリと今後作成されるリポジトリで動かすには、GitHub AppのInstall画面でRepository accessを `All repositories` にしてください。`Only select repositories` を選ぶと、今後作成されるリポジトリは自動では対象になりません。

## GitHub App設定

GitHub Appを作成し、FinShinjukuアカウントへインストールしてください。

Permissions:

- Contents: Read
- Pull requests: Read
- Issues: Read and write
- Metadata: Read

Webhook:

- 公開URLなしで運用する場合は無効でOK
- `BOT_MODE=webhook` または `BOT_MODE=both` の場合だけ有効化
- URL: `https://<your-domain>/webhooks/github`
- Secret: `.env` の `GITHUB_WEBHOOK_SECRET`
- Events: Pull request

Repository access:

- All repositories

Private key:

- `Generate a private key` で `.pem` を発行
- Mac miniでは `GITHUB_PRIVATE_KEY_PATH` に保存先を指定
- `.pem` は `chmod 600` にしてください

## 起動

```bash
cp .env.example .env
npm install
npm run build
npm start
```

公開URLなしで運用する場合は、`.env` を次の方針にします。

```bash
BOT_MODE=poll
POLL_INTERVAL_SECONDS=300
POLL_STATE_PATH=./data/pr-review-state.json
POLL_REPOSITORY_OWNER=FinShinjuku
POLL_REVIEW_EXISTING_ON_FIRST_RUN=false
POLL_MAX_REVIEWS_PER_CYCLE=20
```

初回起動時は既存のopen PRをレビューせず、現在のhead SHAだけを記録します。以後、新規PRまたはhead SHAが変わったPRだけレビューします。

## ローカル開発

```bash
npm run dev
```

ローカルでGitHub Webhookを受ける場合だけ、ngrokやCloudflare Tunnelなどで公開URLを作ってください。polling modeでは不要です。

## OpenClaw設定

このBotはレビュー時に `openclaw agent` を呼び出します。Mac miniの `openclaw` ユーザーで動かす場合は、`.env` で次のように指定してください。

```bash
OPENCLAW_COMMAND=/Users/openclaw/.npm-global/bin/openclaw
OPENCLAW_PATH=/opt/homebrew/opt/node@24/bin:/Users/openclaw/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
OPENCLAW_AGENT=main
OPENCLAW_TIMEOUT_SECONDS=900
```

レビュー結果の要約をLark/FeishuのDMへ送る場合は、OpenClaw側でFeishuチャンネルが動作し、対象ユーザーがペアリング済みである必要があります。

```bash
CHAT_NOTIFY_CHANNEL=feishu
CHAT_NOTIFY_TARGET=user:ou_your_lark_user_open_id
CHAT_NOTIFY_ACCOUNT=default
```

`CHAT_NOTIFY_TARGET` を空にするとチャット通知は無効になります。

## 自動マージについて

このBotは自動マージしません。

95点以上は「AIレビュー上のマージOK候補」としてコメントとラベルを付けます。自動マージを追加する場合は、必ず以下をGitHub APIで確認してからにしてください。

- branch protection
- required status checks
- required reviewers
- mergeable state
- fork PRかどうか

## コスト制御

- draft PRはレビューしません
- polling modeの初回起動では既存open PRをレビューしません
- 同一PR/同一commit SHAの短時間連続イベントは30秒デバウンスします
- polling modeでは同一PR/同一commit SHAを再レビューしません
- `MAX_PATCH_CHARS` でAIに送る差分量を制限します
- GitHub ActionsのCPUは使いません

## セキュリティ

- polling modeでは外部からMac miniへ接続できるURLや受信ポートを作りません
- GitHub Appの権限はレビューに必要な最小限にします
- private key、`.env`、polling stateはリポジトリにコミットしません
- `GITHUB_WEBHOOK_SECRET` はwebhook mode以外では不要です
