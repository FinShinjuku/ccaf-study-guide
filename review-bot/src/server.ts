import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { config } from "./config.js";
import {
  installationClient,
  listPullRequestFiles,
  postReviewComment,
  upsertReviewLabels
} from "./github.js";
import { reviewPullRequest } from "./review.js";

const webhooks = new Webhooks({ secret: config.GITHUB_WEBHOOK_SECRET });
const app = express();
const recentEvents = new Map<string, number>();

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/webhooks/github", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
  const id = req.header("x-github-delivery");
  const name = req.header("x-github-event");
  const signature = req.header("x-hub-signature-256");

  if (!id || !name || !signature) {
    res.status(400).json({ error: "missing GitHub webhook headers" });
    return;
  }

  const payloadText = req.body.toString("utf8");
  const valid = await webhooks.verify(payloadText, signature);
  if (!valid) {
    res.status(401).json({ error: "invalid webhook signature" });
    return;
  }

  res.status(202).json({ ok: true });

  const payload = JSON.parse(payloadText);
  void handleWebhook(name, id, payload).catch((error) => {
    console.error("review failed", error);
  });
});

async function handleWebhook(eventName: string, deliveryId: string, payload: any): Promise<void> {
  if (eventName !== "pull_request") return;
  if (!["opened", "synchronize", "reopened", "ready_for_review"].includes(payload.action)) return;
  if (payload.pull_request?.draft) return;
  if (!payload.installation?.id) throw new Error("missing installation id");

  const dedupeKey = `${payload.repository.full_name}#${payload.pull_request.number}:${payload.pull_request.head.sha}`;
  const now = Date.now();
  const previous = recentEvents.get(dedupeKey);
  if (previous && now - previous < 30_000) return;
  recentEvents.set(dedupeKey, now);

  const [owner, repo] = payload.repository.full_name.split("/");
  const pullNumber = payload.pull_request.number;
  const octokit = await installationClient(payload.installation.id);
  const files = await listPullRequestFiles({ octokit, owner, repo, pullNumber });

  if (files.length === 0) return;

  const result = await reviewPullRequest({
    repoFullName: payload.repository.full_name,
    pullNumber,
    title: payload.pull_request.title,
    body: payload.pull_request.body,
    author: payload.pull_request.user.login,
    files
  });

  await postReviewComment({
    octokit,
    owner,
    repo,
    issueNumber: pullNumber,
    result,
    threshold: config.MERGE_OK_THRESHOLD
  });

  await upsertReviewLabels({
    octokit,
    owner,
    repo,
    issueNumber: pullNumber,
    mergeOk: result.score >= config.MERGE_OK_THRESHOLD
  });

  console.log(`reviewed ${payload.repository.full_name}#${pullNumber} via ${deliveryId}: ${result.score}`);
}

app.listen(config.PORT, () => {
  console.log(`PR review bot listening on :${config.PORT}`);
});
