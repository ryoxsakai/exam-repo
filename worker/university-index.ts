export interface UniversityIndexEnv {
  DB: D1Database;
  IMAGES?: R2Bucket;
}

export interface UniversityIndex {
  version: 1;
  university: { id: number; name: string; reading: string; abbreviation: string };
  exams: Array<{
    id: number;
    year: number;
    schedule: string;
    questions: Array<{ question_number: number; label: string; category: string; zenyaku_title: string }>;
  }>;
}

const keyFor = (universityId: number) => `indexes/universities/v1/${universityId}.json`;

export async function invalidateUniversityIndex(env: UniversityIndexEnv, universityId: number): Promise<void> {
  await env.IMAGES?.delete(keyFor(universityId));
}

export async function invalidateAllUniversityIndexes(env: UniversityIndexEnv): Promise<void> {
  if (!env.IMAGES) return;
  let cursor: string | undefined;
  do {
    const page = await env.IMAGES.list({ prefix: "indexes/universities/v1/", cursor });
    for (const object of page.objects) await env.IMAGES.delete(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// 一覧表示に必要な「全訳」冒頭のタイトルだけを取り出す。本文は JSON に保存しない。
export function extractZenyakuTitle(problemText: string): string {
  const lines = (problemText || "").split("\n");
  let curType = "問題";
  let curLines: string[] = [];
  let zenyakuLines: string[] | null = null;
  for (const raw of lines) {
    const m = raw.trim().match(/^\{\{([^0-9A-Za-z}]+)\}\}$/);
    if (m) {
      if (curType === "全訳" && zenyakuLines === null) zenyakuLines = curLines;
      curType = m[1];
      curLines = [];
    } else {
      curLines.push(raw);
    }
  }
  if (curType === "全訳" && zenyakuLines === null) zenyakuLines = curLines;
  if (!zenyakuLines) return "";
  for (const raw of zenyakuLines) {
    const line = raw.trim();
    if (!line) continue;
    const title = line.match(/^《([^》]+)》/);
    return title ? title[1] : "";
  }
  return "";
}

async function buildUniversityIndex(env: UniversityIndexEnv, universityId: number): Promise<UniversityIndex | null> {
  const university = await env.DB.prepare(
    "SELECT id, name, reading, abbreviation FROM universities WHERE id = ? AND hidden = 0"
  ).bind(universityId).first<UniversityIndex["university"]>();
  if (!university) return null;

  const { results } = await env.DB.prepare(`
    SELECT e.id AS exam_id, e.year, e.schedule,
           q.question_number, q.label, q.category, q.problem_text
    FROM exams e LEFT JOIN questions q ON q.exam_id = e.id
    WHERE e.university_id = ?
    ORDER BY e.year DESC, e.schedule ASC, q.question_number ASC
  `).bind(universityId).all<{
    exam_id: number; year: number; schedule: string;
    question_number: number | null; label: string | null;
    category: string | null; problem_text: string | null;
  }>();
  const exams: UniversityIndex["exams"] = [];
  const byId = new Map<number, UniversityIndex["exams"][number]>();
  for (const row of results) {
    let exam = byId.get(row.exam_id);
    if (!exam) {
      exam = { id: row.exam_id, year: row.year, schedule: row.schedule, questions: [] };
      byId.set(row.exam_id, exam);
      exams.push(exam);
    }
    if (row.question_number !== null) {
      exam.questions.push({
        question_number: row.question_number,
        label: row.label || "",
        category: row.category || "",
        zenyaku_title: row.category === "長文" ? extractZenyakuTitle(row.problem_text || "") : "",
      });
    }
  }
  return { version: 1, university, exams };
}

// 更新時は該当大学だけ再構築する。初回閲覧時にも同じ関数で既存データを埋める。
export async function refreshUniversityIndex(env: UniversityIndexEnv, universityId: number): Promise<UniversityIndex | null> {
  if (!env.IMAGES) throw new Error("R2 binding is unavailable for university indexes");
  const index = await buildUniversityIndex(env, universityId);
  if (index) {
    await env.IMAGES.put(keyFor(universityId), JSON.stringify(index), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  } else {
    await env.IMAGES.delete(keyFor(universityId));
  }
  return index;
}

export async function readUniversityIndex(env: UniversityIndexEnv, universityId: number): Promise<UniversityIndex | null> {
  if (!env.IMAGES) throw new Error("R2 binding is unavailable for university indexes");
  const cached = await env.IMAGES.get(keyFor(universityId));
  if (cached) return JSON.parse(await cached.text()) as UniversityIndex;
  return refreshUniversityIndex(env, universityId);
}

// DB 保存後の索引障害を保存失敗と誤認させない。可能なら旧索引を消して次の閲覧で再生成する。
export async function safeRefreshUniversityIndex(env: UniversityIndexEnv, universityId: number): Promise<boolean> {
  try {
    await refreshUniversityIndex(env, universityId);
    return true;
  } catch (error) {
    console.error("University index refresh failed", universityId, error);
    try { await invalidateUniversityIndex(env, universityId); } catch (invalidateError) {
      console.error("University index invalidation failed", universityId, invalidateError);
    }
    return false;
  }
}

export async function safeRefreshUniversityIndexForExam(env: UniversityIndexEnv, examId: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT university_id FROM exams WHERE id = ?")
      .bind(examId).first<{ university_id: number }>();
    return row ? safeRefreshUniversityIndex(env, row.university_id) : true;
  } catch (error) {
    console.error("University index lookup failed", examId, error);
    return false;
  }
}
