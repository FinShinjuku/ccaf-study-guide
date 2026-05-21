import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  PUBLIC_BASE_URL: z.string().optional(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  MERGE_OK_THRESHOLD: z.coerce.number().min(0).max(100).default(95),
  MAX_PATCH_CHARS: z.coerce.number().min(10000).default(60000),
  REVIEW_LABEL_OK: z.string().default("ai-review:merge-ok"),
  REVIEW_LABEL_NEEDS_WORK: z.string().default("ai-review:needs-work")
});

export const config = schema.parse(process.env);

export function githubPrivateKey(): string {
  return config.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
}
