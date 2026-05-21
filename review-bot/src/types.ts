export type PullRequestFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type ReviewFinding = {
  severity: "critical" | "major" | "minor";
  file: string;
  line: number | null;
  title: string;
  detail: string;
  suggestion: string;
};

export type ReviewResult = {
  score: number;
  summary: string;
  merge_ok: boolean;
  subscores: {
    correctness: number;
    test_coverage: number;
    maintainability: number;
    security: number;
    performance: number;
    product_fit: number;
  };
  findings: ReviewFinding[];
  follow_up_questions: string[];
};
