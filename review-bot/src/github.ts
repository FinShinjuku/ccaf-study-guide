import { App } from "@octokit/app";
import type { Octokit } from "@octokit/rest";
import { config, githubPrivateKey } from "./config.js";
import type { PullRequestFile, ReviewResult } from "./types.js";

export const app = new App({
  appId: config.GITHUB_APP_ID,
  privateKey: githubPrivateKey()
});

export async function installationClient(installationId: number): Promise<InstanceType<typeof Octokit>> {
  return app.getInstallationOctokit(installationId) as Promise<InstanceType<typeof Octokit>>;
}

export async function listPullRequestFiles(params: {
  octokit: InstanceType<typeof Octokit>;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<PullRequestFile[]> {
  const files = await params.octokit.paginate(params.octokit.rest.pulls.listFiles, {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    per_page: 100
  });

  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch
  }));
}

export async function upsertReviewLabels(params: {
  octokit: InstanceType<typeof Octokit>;
  owner: string;
  repo: string;
  issueNumber: number;
  mergeOk: boolean;
}): Promise<void> {
  const wanted = params.mergeOk ? config.REVIEW_LABEL_OK : config.REVIEW_LABEL_NEEDS_WORK;
  const unwanted = params.mergeOk ? config.REVIEW_LABEL_NEEDS_WORK : config.REVIEW_LABEL_OK;

  await ensureLabel(params.octokit, params.owner, params.repo, config.REVIEW_LABEL_OK, "0E8A16");
  await ensureLabel(params.octokit, params.owner, params.repo, config.REVIEW_LABEL_NEEDS_WORK, "D93F0B");

  await params.octokit.rest.issues.addLabels({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    labels: [wanted]
  });

  await params.octokit.rest.issues.removeLabel({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    name: unwanted
  }).catch((error: unknown) => {
    if (typeof error === "object" && error && "status" in error && error.status === 404) return;
    throw error;
  });
}

async function ensureLabel(
  octokit: InstanceType<typeof Octokit>,
  owner: string,
  repo: string,
  name: string,
  color: string
): Promise<void> {
  await octokit.rest.issues.getLabel({ owner, repo, name }).catch(async (error: unknown) => {
    if (typeof error === "object" && error && "status" in error && error.status === 404) {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name,
        color,
        description: "AI pull request review status"
      });
      return;
    }
    throw error;
  });
}

export async function postReviewComment(params: {
  octokit: InstanceType<typeof Octokit>;
  owner: string;
  repo: string;
  issueNumber: number;
  result: ReviewResult;
  threshold: number;
}): Promise<void> {
  await params.octokit.rest.issues.createComment({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    body: formatReviewComment(params.result, params.threshold)
  });
}

function formatReviewComment(result: ReviewResult, threshold: number): string {
  const verdict = result.score >= threshold ? "マージOK候補" : "改善が必要";
  const findings = result.findings.length
    ? result.findings.map((finding, index) => {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      return `${index + 1}. **${finding.severity.toUpperCase()}** ${location} - ${finding.title}\n   - ${finding.detail}\n   - 修正案: ${finding.suggestion}`;
    }).join("\n")
    : "重大な指摘はありません。";

  const questions = result.follow_up_questions.length
    ? result.follow_up_questions.map((question) => `- ${question}`).join("\n")
    : "- なし";

  return `## AI PR Review\n\n**Score:** ${result.score}/100\n**Verdict:** ${verdict}\n\n${result.summary}\n\n### Subscores\n\n- correctness: ${result.subscores.correctness}/30\n- test_coverage: ${result.subscores.test_coverage}/20\n- maintainability: ${result.subscores.maintainability}/15\n- security: ${result.subscores.security}/15\n- performance: ${result.subscores.performance}/10\n- product_fit: ${result.subscores.product_fit}/10\n\n### Findings\n\n${findings}\n\n### Follow-up Questions\n\n${questions}\n\n---\n\n95点以上はAIレビュー上のマージOK候補です。最終判断では、要件意図と既存CI/branch protectionの状態も確認してください。`;
}
