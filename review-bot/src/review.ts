import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { config, openClawEnv } from "./config.js";
import type { PullRequestFile, ReviewResult } from "./types.js";

const execFileAsync = promisify(execFile);

const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  merge_ok: z.boolean(),
  subscores: z.object({
    correctness: z.number().min(0).max(30),
    test_coverage: z.number().min(0).max(20),
    maintainability: z.number().min(0).max(15),
    security: z.number().min(0).max(15),
    performance: z.number().min(0).max(10),
    product_fit: z.number().min(0).max(10)
  }),
  findings: z.array(z.object({
    severity: z.enum(["critical", "major", "minor"]),
    file: z.string(),
    line: z.number().nullable(),
    title: z.string(),
    detail: z.string(),
    suggestion: z.string()
  })),
  follow_up_questions: z.array(z.string())
});

export async function reviewPullRequest(params: {
  repoFullName: string;
  pullNumber: number;
  title: string;
  body: string | null;
  author: string;
  files: PullRequestFile[];
}): Promise<ReviewResult> {
  const rubric = await readFile(new URL("../prompts/pr-review.md", import.meta.url), "utf8");
  const diff = compactDiff(params.files, config.MAX_PATCH_CHARS);
  const raw = await runOpenClawReview(buildReviewPrompt({
    rubric,
    repoFullName: params.repoFullName,
    pullNumber: params.pullNumber,
    title: params.title,
    body: params.body,
    author: params.author,
    files: params.files,
    diff
  }));
  const parsed = reviewSchema.parse(JSON.parse(extractJsonObject(raw)));
  const score = clampScore(parsed.score);
  return {
    ...parsed,
    score,
    merge_ok: score >= config.MERGE_OK_THRESHOLD
  };
}

function buildReviewPrompt(params: {
  rubric: string;
  repoFullName: string;
  pullNumber: number;
  title: string;
  body: string | null;
  author: string;
  files: PullRequestFile[];
  diff: string;
}): string {
  return [
    params.rubric,
    "",
    "Return only a valid JSON object. Do not wrap the response in Markdown.",
    "The JSON object must match this shape exactly:",
    JSON.stringify({
      score: 0,
      summary: "string",
      merge_ok: false,
      subscores: {
        correctness: 0,
        test_coverage: 0,
        maintainability: 0,
        security: 0,
        performance: 0,
        product_fit: 0
      },
      findings: [
        {
          severity: "critical|major|minor",
          file: "path",
          line: null,
          title: "string",
          detail: "string",
          suggestion: "string"
        }
      ],
      follow_up_questions: ["string"]
    }),
    "",
    "Pull request payload:",
    JSON.stringify({
      repository: params.repoFullName,
      pull_request: {
        number: params.pullNumber,
        title: params.title,
        body: params.body,
        author: params.author
      },
      changed_files: params.files.map(({ patch: _patch, ...file }) => file)
    }),
    "",
    "Diff:",
    params.diff
  ].join("\n");
}

async function runOpenClawReview(message: string): Promise<string> {
  const args = ["agent"];
  if (config.OPENCLAW_AGENT?.trim()) args.push("--agent", config.OPENCLAW_AGENT.trim());
  args.push(
    "--message",
    message,
    "--timeout",
    String(config.OPENCLAW_TIMEOUT_SECONDS),
    "--json"
  );

  const { stdout, stderr } = await execFileAsync(config.OPENCLAW_COMMAND, args, {
    env: openClawEnv(),
    maxBuffer: 20 * 1024 * 1024,
    timeout: (config.OPENCLAW_TIMEOUT_SECONDS + 30) * 1000
  });

  const text = extractOpenClawText(stdout);
  if (text) return text;
  if (stdout.trim()) return stdout;
  throw new Error(`OpenClaw review returned empty output${stderr ? `: ${stderr}` : ""}`);
}

function extractOpenClawText(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const found = collectStrings(parsed)
      .map((value) => value.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return found[0] ?? null;
  } catch {
    return null;
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  const record = value as Record<string, unknown>;
  const preferred = [
    "final",
    "reply",
    "message",
    "content",
    "text",
    "answer",
    "output",
    "result"
  ];
  return [
    ...preferred.flatMap((key) => collectStrings(record[key])),
    ...Object.entries(record)
      .filter(([key]) => !preferred.includes(key))
      .flatMap(([, nested]) => collectStrings(nested))
  ];
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(unfenced);
    if (typeof parsed === "object" && parsed && "score" in parsed) return unfenced;
  } catch {
    // Fall through to balanced-object extraction.
  }

  for (let start = unfenced.indexOf("{"); start >= 0; start = unfenced.indexOf("{", start + 1)) {
    const candidate = balancedObjectAt(unfenced, start);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed && "score" in parsed) return candidate;
    } catch {
      // Keep scanning.
    }
  }

  throw new Error("OpenClaw review did not contain a valid review JSON object");
}

function balancedObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function compactDiff(files: PullRequestFile[], maxChars: number): string {
  let output = "";
  for (const file of files) {
    const header = `\n\n--- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions}) ---\n`;
    const patch = file.patch ?? "[No textual patch available: binary file, rename-only file, or patch too large]";
    const next = header + patch;
    if (output.length + next.length > maxChars) {
      output += `\n\n[Diff truncated at ${maxChars} characters. Review visible files and flag risk from truncation if important.]\n`;
      break;
    }
    output += next;
  }
  return output;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
