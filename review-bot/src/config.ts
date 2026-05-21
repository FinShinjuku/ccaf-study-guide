import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const schema = z.object({
  BOT_MODE: z.enum(["webhook", "poll", "both"]).default("webhook"),
  PORT: z.coerce.number().default(8787),
  PUBLIC_BASE_URL: z.string().optional(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  OPENCLAW_COMMAND: z.string().default("openclaw"),
  OPENCLAW_PATH: z.string().default("/opt/homebrew/opt/node@24/bin:/Users/openclaw/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"),
  OPENCLAW_AGENT: z.string().default("main"),
  OPENCLAW_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(300),
  POLL_STATE_PATH: z.string().default("./data/pr-review-state.json"),
  POLL_REPOSITORY_OWNER: z.string().default("FinShinjuku"),
  POLL_REVIEW_EXISTING_ON_FIRST_RUN: booleanFromEnv.default(false),
  POLL_MAX_REVIEWS_PER_CYCLE: z.coerce.number().int().positive().default(20),
  MERGE_OK_THRESHOLD: z.coerce.number().min(0).max(100).default(95),
  MAX_PATCH_CHARS: z.coerce.number().min(10000).default(60000),
  REVIEW_LABEL_OK: z.string().default("ai-review:merge-ok"),
  REVIEW_LABEL_NEEDS_WORK: z.string().default("ai-review:needs-work"),
  CHAT_NOTIFY_CHANNEL: z.string().default("feishu"),
  CHAT_NOTIFY_TARGET: z.string().optional(),
  CHAT_NOTIFY_ACCOUNT: z.string().optional()
}).superRefine((value, ctx) => {
  if ((value.BOT_MODE === "webhook" || value.BOT_MODE === "both") && !value.GITHUB_WEBHOOK_SECRET?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GITHUB_WEBHOOK_SECRET"],
      message: "GITHUB_WEBHOOK_SECRET is required when BOT_MODE is webhook or both"
    });
  }
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
