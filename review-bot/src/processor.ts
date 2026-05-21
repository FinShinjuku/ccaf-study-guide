import { config } from "./config.js";
import {
  type GitHubClient,
  listPullRequestFiles,
  postReviewComment,
  upsertReviewLabels
} from "./github.js";
import { notifyReviewSummary } from "./notify.js";
import { reviewPullRequest } from "./review.js";
import type { ReviewResult } from "./types.js";

export async function processPullRequest(params: {
  octokit: GitHubClient;
  repoFullName: string;
  pullNumber: number;
  pullUrl: string;
  title: string;
  body: string | null;
  author: string;
}): Promise<ReviewResult | null> {
  const [owner, repo] = splitRepoFullName(params.repoFullName);
  const files = await listPullRequestFiles({
    octokit: params.octokit,
    owner,
    repo,
    pullNumber: params.pullNumber
  });

  if (files.length === 0) return null;

  const result = await reviewPullRequest({
    repoFullName: params.repoFullName,
    pullNumber: params.pullNumber,
    title: params.title,
    body: params.body,
    author: params.author,
    files
  });

  await postReviewComment({
    octokit: params.octokit,
    owner,
    repo,
    issueNumber: params.pullNumber,
    result,
    threshold: config.MERGE_OK_THRESHOLD
  });

  await upsertReviewLabels({
    octokit: params.octokit,
    owner,
    repo,
    issueNumber: params.pullNumber,
    mergeOk: result.score >= config.MERGE_OK_THRESHOLD
  });

  await notifyReviewSummary({
    repoFullName: params.repoFullName,
    pullNumber: params.pullNumber,
    pullUrl: params.pullUrl,
    title: params.title,
    result
  }).catch((error) => {
    console.error("chat notification failed", error);
  });

  return result;
}

export function splitRepoFullName(fullName: string): [string, string] {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`invalid repository full_name: ${fullName}`);
  return [owner, repo];
}
