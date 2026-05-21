import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";
import {
  installationClient,
  listInstallationIds,
  listInstallationRepositories,
  listOpenPullRequests
} from "./github.js";
import { processPullRequest, splitRepoFullName } from "./processor.js";

type PullState = {
  headSha: string;
  updatedAt: string;
  reviewedAtMs?: number;
  score?: number;
};

type PollState = {
  initialized: boolean;
  pulls: Record<string, PullState>;
};

let running = false;

export function startPoller(): void {
  const intervalMs = config.POLL_INTERVAL_SECONDS * 1000;
  void pollOnce().catch((error) => {
    console.error("poll failed", error);
  });
  setInterval(() => {
    void pollOnce().catch((error) => {
      console.error("poll failed", error);
    });
  }, intervalMs);
  console.log(`PR polling enabled every ${config.POLL_INTERVAL_SECONDS}s`);
}

async function pollOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const state = await loadState();
    const firstRun = !state.initialized;
    let reviewsThisCycle = 0;

    for (const installationId of await listInstallationIds()) {
      const octokit = await installationClient(installationId);
      const repositories = await listInstallationRepositories({ octokit });

      for (const repository of repositories) {
        const repoFullName = repository.full_name;
        if (!repoFullName || repository.archived) continue;
        if (config.POLL_REPOSITORY_OWNER && !repoFullName.startsWith(`${config.POLL_REPOSITORY_OWNER}/`)) continue;

        const [owner, repo] = splitRepoFullName(repoFullName);
        const pulls = await listOpenPullRequests({ octokit, owner, repo });

        for (const pull of pulls) {
          if (pull.draft) continue;
          const key = `${repoFullName}#${pull.number}`;
          const previous = state.pulls[key];
          const current: PullState = {
            headSha: pull.head.sha,
            updatedAt: pull.updated_at
          };

          if (previous?.headSha === pull.head.sha) continue;

          if (firstRun && !config.POLL_REVIEW_EXISTING_ON_FIRST_RUN) {
            state.pulls[key] = current;
            continue;
          }

          if (reviewsThisCycle >= config.POLL_MAX_REVIEWS_PER_CYCLE) {
            state.pulls[key] = previous ?? current;
            continue;
          }

          console.log(`reviewing ${key} (${pull.head.sha})`);
          const result = await processPullRequest({
            octokit,
            repoFullName,
            pullNumber: pull.number,
            pullUrl: pull.html_url,
            title: pull.title,
            body: pull.body,
            author: pull.user?.login ?? "unknown"
          });

          reviewsThisCycle += 1;
          state.pulls[key] = {
            ...current,
            reviewedAtMs: Date.now(),
            ...(result ? { score: result.score } : {})
          };
          await saveState(state);
        }
      }
    }

    state.initialized = true;
    await saveState(state);
  } finally {
    running = false;
  }
}

async function loadState(): Promise<PollState> {
  try {
    return JSON.parse(await readFile(config.POLL_STATE_PATH, "utf8")) as PollState;
  } catch (error: unknown) {
    if (isMissingFileError(error)) return { initialized: false, pulls: {} };
    throw error;
  }
}

async function saveState(state: PollState): Promise<void> {
  await mkdir(dirname(config.POLL_STATE_PATH), { recursive: true });
  const tmp = `${config.POLL_STATE_PATH}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmp, config.POLL_STATE_PATH);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
