import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config, openClawEnv } from "./config.js";
import type { ReviewResult } from "./types.js";

const execFileAsync = promisify(execFile);

export async function notifyReviewSummary(params: {
  repoFullName: string;
  pullNumber: number;
  pullUrl: string;
  title: string;
  result: ReviewResult;
}): Promise<void> {
  if (!config.CHAT_NOTIFY_TARGET?.trim()) return;

  const args = [
    "message",
    "send",
    "--channel",
    config.CHAT_NOTIFY_CHANNEL,
    "--target",
    config.CHAT_NOTIFY_TARGET.trim(),
    "--message",
    formatSummary(params),
    "--json"
  ];
  if (config.CHAT_NOTIFY_ACCOUNT?.trim()) {
    args.push("--account", config.CHAT_NOTIFY_ACCOUNT.trim());
  }

  await execFileAsync(config.OPENCLAW_COMMAND, args, {
    env: openClawEnv(),
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000
  });
}

function formatSummary(params: {
  repoFullName: string;
  pullNumber: number;
  pullUrl: string;
  title: string;
  result: ReviewResult;
}): string {
  const verdict = params.result.score >= config.MERGE_OK_THRESHOLD
    ? "merge-ok"
    : "needs-work";
  const topFindings = params.result.findings.slice(0, 3);
  const findings = topFindings.length
    ? topFindings.map((finding, index) => {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      return `${index + 1}. [${finding.severity}] ${location} - ${finding.title}`;
    }).join("\n")
    : "重大な指摘はありません。";

  return [
    `OpenClaw PR Review: ${params.repoFullName}#${params.pullNumber}`,
    `Title: ${params.title}`,
    `Score: ${params.result.score}/100 (${verdict})`,
    `URL: ${params.pullUrl}`,
    "",
    "Summary:",
    params.result.summary,
    "",
    "Top findings:",
    findings
  ].join("\n");
}
