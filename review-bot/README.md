# FinShinjuku OpenClaw PR Review Bot

GitHub Actionsを使わず、GitHub AppのWebhookでPRをOpenClawにレビューさせる軽量Botです。

## できること

- `pull_request.opened`
- `pull_request.synchronize`
- `pull_request.reopened`
- `pull_request.ready_for_review`

上記イベントでPR差分を取得し、AIレビューを実行します。

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

- URL: `https://<your-domain>/webhooks/github`
- Secret: `.env` の `GITHUB_WEBHOOK_SECRET`
- Events: Pull request

Repository access:

- All repositories

## 起動

```bash
cp .env.example .env
npm install
npm run build
npm start
```

## ローカル開発

```bash
npm run dev
```

ローカルでGitHub Webhookを受ける場合は、ngrokやCloudflare Tunnelなどで公開URLを作ってください。

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
- 同一PR/同一commit SHAの短時間連続イベントは30秒デバウンスします
- `MAX_PATCH_CHARS` でAIに送る差分量を制限します
- GitHub ActionsのCPUは使いません
