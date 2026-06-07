// Client-side API helper. Reads Worker URL from localStorage (admin override)
// or falls back to the URL baked in at build time via NEXT_PUBLIC_WORKER_URL.

const ENV_WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || "").replace(/\/$/, "");

export function getWorkerUrl(): string {
  if (typeof window === "undefined") return ENV_WORKER_URL;
  return (localStorage.getItem("cf_worker_url") || ENV_WORKER_URL).replace(/\/$/, "");
}

async function call<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getWorkerUrl();
  if (!base) {
    throw new Error(
      "Worker URLが未設定です。/admin の「設定」タブで Worker URL を入力・保存してください。"
    );
  }
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(data.message || data.error || `APIエラー ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────

export interface SearchResult {
  exam_id: number;
  university_name: string;
  year: number;
  schedule: string;
  question_count: number;
  total_occurrences: number;
  matching_questions: string;
}

export interface Question {
  id: number;
  exam_id: number;
  question_number: number;
  problem_text: string;
  answer_text: string;
  commentary_text: string;
}

export interface ExamDetail {
  id: number;
  university_name: string;
  year: number;
  schedule: string;
  questions: Question[];
}

// ── API calls ──────────────────────────────────────────────────────

export function searchExams(params: {
  word?: string;
  universityName?: string;
  year?: string;
  schedule?: string;
}): Promise<{ results: SearchResult[] }> {
  const q = new URLSearchParams();
  if (params.word)           q.set("word",           params.word);
  if (params.universityName) q.set("universityName", params.universityName);
  if (params.year)           q.set("year",           params.year);
  if (params.schedule)       q.set("schedule",       params.schedule);
  return call<{ results: SearchResult[] }>(`/api/search?${q.toString()}`);
}

export function getExam(examId: number): Promise<{ exam: ExamDetail }> {
  return call<{ exam: ExamDetail }>(`/api/exams/${examId}`);
}

export function createExam(data: {
  universityName: string;
  year: number;
  schedule: string;
  questions: Array<{
    questionNumber: number;
    problemText: string;
    answerText: string;
    commentaryText: string;
  }>;
}): Promise<{ exam: ExamDetail; questions: Question[] }> {
  return call("/api/exams", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getUniversities(): Promise<{ universities: Array<{ id: number; name: string }> }> {
  return call<{ universities: Array<{ id: number; name: string }> }>("/api/universities");
}

export function deleteUniversity(id: number): Promise<{ success: boolean }> {
  return call<{ success: boolean }>(`/api/universities/${id}`, { method: "DELETE" });
}

export function deleteExam(id: number): Promise<{ success: boolean }> {
  return call<{ success: boolean }>(`/api/exams/${id}`, { method: "DELETE" });
}

export interface AppConfig {
  schedules: string[];
  year_presets: string[];
  site_title?: string;
  markup_css?: string;
}

export function getConfig(): Promise<AppConfig> {
  return call<AppConfig>("/api/config");
}

export function updateConfig(data: Partial<AppConfig>): Promise<{ success: boolean }> {
  return call<{ success: boolean }>("/api/config", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function updateExam(examId: number, data: {
  universityName?: string;
  year?: number;
  schedule?: string;
  questions?: Array<{
    questionNumber: number;
    problemText: string;
    answerText: string;
    commentaryText: string;
  }>;
}): Promise<{ exam: ExamDetail }> {
  return call<{ exam: ExamDetail }>(`/api/exams/${examId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function testConnection(): Promise<{ universities: Array<{ id: number; name: string }> }> {
  return getUniversities();
}
