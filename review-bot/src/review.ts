import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import type { PullRequestFile, ReviewResult } from "./types.js";

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

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

  const response = await client.chat.completions.create({
    model: config.OPENAI_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: rubric },
      {
        role: "user",
        content: JSON.stringify({
          repository: params.repoFullName,
          pull_request: {
            number: params.pullNumber,
            title: params.title,
            body: params.body,
            author: params.author
          },
          changed_files: params.files.map(({ patch: _patch, ...file }) => file),
          diff
        })
      }
    ]
  });

  const raw = response.choices[0]?.message.content;
  if (!raw) throw new Error("AI review returned empty content");

  const parsed = reviewSchema.parse(JSON.parse(raw));
  const score = clampScore(parsed.score);
  return {
    ...parsed,
    score,
    merge_ok: score >= config.MERGE_OK_THRESHOLD
  };
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
