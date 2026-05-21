import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  PUBLIC_BASE_URL: z.string().optional(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  OPENCLAW_COMMAND: z.string().default("openclaw"),
  OPENCLAW_PATH: z.string().default("/opt/homebrew/opt/node@24/bin:/Users/openclaw/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"),
  OPENCLAW_AGENT: z.string().default("main"),
  OPENCLAW_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  MERGE_OK_THRESHOLD: z.coerce.number().min(0).max(100).default(95),
  MAX_PATCH_CHARS: z.coerce.number().min(10000).default(60000),
  REVIEW_LABEL_OK: z.string().default("ai-review:merge-ok"),
  REVIEW_LABEL_NEEDS_WORK: z.string().default("ai-review:needs-work"),
  CHAT_NOTIFY_CHANNEL: z.string().default("feishu"),
  CHAT_NOTIFY_TARGET: z.string().optional(),
  CHAT_NOTIFY_ACCOUNT: z.string().optional()
});

export const config = schema.parse(process.env);

export function githubPrivateKey(): string {
  return config.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
}

export function openClawEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: config.OPENCLAW_PATH || process.env.PATH
  };
}
