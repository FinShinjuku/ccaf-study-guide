import { App } from "@octokit/app";
import { config, githubPrivateKey } from "./config.js";
import type { PullRequestFile, ReviewResult } from "./types.js";

export const app = new App({
  appId: config.GITHUB_APP_ID,
  privateKey: githubPrivateKey()
});

export type GitHubClient = Awaited<ReturnType<typeof app.getInstallationOctokit>>;

type RequestFn = (route: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown }>;

export async function installationClient(installationId: number): Promise<GitHubClient> {
  return app.getInstallationOctokit(installationId);
}

export async function listInstallationIds(): Promise<number[]> {
  const data = await requestData(app.octokit as GitHubClient, "GET /app/installations", {
    per_page: 100
  });
  return asArray<{ id: number }>(data, "installations").map((installation) => installation.id);
}

export async function listInstallationRepositories(params: {
  octokit: GitHubClient;
}): Promise<Array<{ full_name?: string; archived?: boolean }>> {
  const repositories: Array<{ full_name?: string; archived?: boolean }> = [];

  for (let page = 1; ; page += 1) {
    const data = asRecord(await requestData(params.octokit, "GET /installation/repositories", {
      per_page: 100,
      page
    }), "installation repositories");
    const pageRepositories = asArray<{ full_name?: string; archived?: boolean }>(
      data.repositories,
      "installation repositories"
    );
    repositories.push(...pageRepositories);
    if (pageRepositories.length < 100) break;
  }

  return repositories;
}

export async function listOpenPullRequests(params: {
  octokit: GitHubClient;
  owner: string;
  repo: string;
}): Promise<Array<{
  number: number;
  title: string;
  body: string | null;
  draft?: boolean;
  html_url: string;
  updated_at: string;
  head: { sha: string };
  user: { login: string } | null;
}>> {
  return paginateArray(params.octokit, "GET /repos/{owner}/{repo}/pulls", {
    owner: params.owner,
    repo: params.repo,
    state: "open",
    sort: "updated",
    direction: "desc"
  });
}

export async function listPullRequestFiles(params: {
  octokit: GitHubClient;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<PullRequestFile[]> {
  const files = await paginateArray<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>(params.octokit, "GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber
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
  octokit: GitHubClient;
  owner: string;
  repo: string;
  issueNumber: number;
  mergeOk: boolean;
}): Promise<void> {
  const wanted = params.mergeOk ? config.REVIEW_LABEL_OK : config.REVIEW_LABEL_NEEDS_WORK;
  const unwanted = params.mergeOk ? config.REVIEW_LABEL_NEEDS_WORK : config.REVIEW_LABEL_OK;

  await ensureLabel(params.octokit, params.owner, params.repo, config.REVIEW_LABEL_OK, "0E8A16");
  await ensureLabel(params.octokit, params.owner, params.repo, config.REVIEW_LABEL_NEEDS_WORK, "D93F0B");

  await requestData(params.octokit, "POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    labels: [wanted]
  });

  await requestData(params.octokit, "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}", {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    name: unwanted
  }).catch((error: unknown) => {
    if (isHttpStatus(error, 404)) return;
    throw error;
  });
}

async function ensureLabel(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  name: string,
  color: string
): Promise<void> {
  await requestData(octokit, "GET /repos/{owner}/{repo}/labels/{name}", { owner, repo, name }).catch(
    async (error: unknown) => {
      if (isHttpStatus(error, 404)) {
        await requestData(octokit, "POST /repos/{owner}/{repo}/labels", {
          owner,
          repo,
          name,
          color,
          description: "AI pull request review status"
        });
        return;
      }
      throw error;
    }
  );
}

export async function postReviewComment(params: {
  octokit: GitHubClient;
  owner: string;
  repo: string;
  issueNumber: number;
  result: ReviewResult;
  threshold: number;
}): Promise<void> {
  await requestData(params.octokit, "POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    body: formatReviewComment(params.result, params.threshold)
  });
}

async function paginateArray<T>(
  octokit: GitHubClient,
  route: string,
  parameters: Record<string, unknown>
): Promise<T[]> {
  const results: T[] = [];

  for (let page = 1; ; page += 1) {
    const items = asArray<T>(await requestData(octokit, route, {
      ...parameters,
      per_page: 100,
      page
    }), route);
    results.push(...items);
    if (items.length < 100) break;
  }

  return results;
}

async function requestData(
  octokit: GitHubClient,
  route: string,
  parameters?: Record<string, unknown>
): Promise<unknown> {
  const request = octokit.request as unknown as RequestFn;
  const response = await request(route, parameters);
  return response.data;
}

function asArray<T>(value: unknown, name: string): T[] {
  if (Array.isArray(value)) return value as T[];
  throw new Error(`unexpected GitHub ${name} response`);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  throw new Error(`unexpected GitHub ${name} response`);
}

function isHttpStatus(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === status;
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
