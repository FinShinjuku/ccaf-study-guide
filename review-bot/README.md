# FinShinjuku PR Review Bot

GitHub Actionsを使わず、GitHub AppのWebhookでPRをAIレビューする軽量Botです。

## できること

- `pull_request.opened`
- `pull_request.synchronize`
- `pull_request.reopened`
- `pull_request.ready_for_review`

上記イベントでPR差分を取得し、AIレビューを実行します。

- 品質スコアを0-100で算出
- 95点以上なら `ai-review:merge-ok` ラベル
- 95点未満なら `ai-review:needs-work` ラベル
- PRにレビューコメントを投稿

GitHub Actions runnerは使いません。

## GitHub App設定

GitHub Appを作成し、対象リポジトリへインストールしてください。

Permissions:

- Contents: Read
- Pull requests: Read
- Issues: Read and write
- Metadata: Read

Webhook:

- URL: `https://<your-domain>/webhooks/github`
- Secret: `.env` の `GITHUB_WEBHOOK_SECRET`
- Events: Pull request

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
