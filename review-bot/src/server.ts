import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { config } from "./config.js";
import { installationClient } from "./github.js";
import { startPoller } from "./poller.js";
import { processPullRequest } from "./processor.js";

const webhooks = config.GITHUB_WEBHOOK_SECRET
  ? new Webhooks({ secret: config.GITHUB_WEBHOOK_SECRET })
  : null;
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
  if (!webhooks) {
    res.status(503).json({ error: "webhook mode is not configured" });
    return;
  }
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

  const pullNumber = payload.pull_request.number;
  const octokit = await installationClient(payload.installation.id);
  const result = await processPullRequest({
    octokit,
    repoFullName: payload.repository.full_name,
    pullNumber,
    pullUrl: payload.pull_request.html_url,
    title: payload.pull_request.title,
    body: payload.pull_request.body,
    author: payload.pull_request.user.login
  });

  console.log(`reviewed ${payload.repository.full_name}#${pullNumber} via ${deliveryId}: ${result?.score ?? "no-files"}`);
}

if (config.BOT_MODE === "webhook" || config.BOT_MODE === "both") {
  app.listen(config.PORT, () => {
    console.log(`PR review bot listening on :${config.PORT}`);
  });
}

if (config.BOT_MODE === "poll" || config.BOT_MODE === "both") {
  startPoller();
}
