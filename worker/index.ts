export interface Env {
  DB: D1Database;
}

function cors(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-anthropic-key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// questions テーブルに category 列が無い既存DBへの後方互換マイグレーション
async function ensureCategoryColumn(env: Env) {
  try {
    await env.DB.exec("ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  } catch {
    // 既に列が存在する場合は無視
  }
}

// question_number = 0 のレコードを修正（各 exam 内で id 順に 1 始まりで採番）
async function fixZeroQuestionNumbers(env: Env) {
  const zeros = await env.DB.prepare(
    "SELECT id, exam_id FROM questions WHERE question_number <= 0 ORDER BY exam_id, id"
  ).all<{ id: number; exam_id: number }>();
  if (!zeros.results.length) return;

  // exam_id ごとに既存の最大番号を取得してから採番
  const examMax: Record<number, number> = {};
  for (const row of zeros.results) {
    if (!(row.exam_id in examMax)) {
      const maxRow = await env.DB.prepare(
        "SELECT MAX(question_number) AS m FROM questions WHERE exam_id = ? AND question_number > 0"
      ).bind(row.exam_id).first<{ m: number | null }>();
      examMax[row.exam_id] = maxRow?.m ?? 0;
    }
    examMax[row.exam_id] += 1;
    await env.DB.prepare("UPDATE questions SET question_number = ? WHERE id = ?")
      .bind(examMax[row.exam_id], row.id).run();
  }
}

// ───────────────────────────────────────────────────────────────────
// PDF 自動取り込み（Anthropic API でスキャンPDF→構造化問題データ）
// APIキーはリクエストヘッダ x-anthropic-key で受け取り、サーバ側には保存しない。
// ───────────────────────────────────────────────────────────────────
const INGEST_SYSTEM = `あなたは日本の大学入試（英語）の冊子PDFを読み取り、構造化された問題データに変換するアシスタントです。

# 入力
1つのPDFには、ある年度・大学・方式の全大問が含まれます。冊子は多くの場合「問題（大問1〜N）→ 解答 → 解説」のようにセクション単位で並んでいます。

# タスク
PDFを読み取り、大問ごとにまとめ直してください。各大問は内容に応じて複数のセクションに分割し、各セクションに種別(type)を付けて sections 配列で出力します。冊子の並び順を保ってください。解答ページや解説ページの「(1)…」等は、対応する大問へ必ず紐づけてください。該当が無い種別のセクションは作らないでください。

# セクション種別(type)
- 「本文」: 長文読解の英文パッセージ本体
- 「設問」: その大問の設問（問1・問2…や下線部問題など）。長文読解では本文と分け、設問だけをここにまとめる。
- 「問題」: 文法・語彙・整序・英作文など、本文と設問に分けにくいものはまとめてここに入れる
- 「解答」: 解答・正解
- 「解説」: 解説・考え方
- 「全訳」: 本文の全訳・全文和訳。省略してはいけない。解説に混ぜず必ず独立した「全訳」セクションにする。

長文読解の大問は「本文」と「設問」に分ける（＋必要に応じて「解答」「解説」「全訳」）。文法・語彙などの大問は「問題」にまとめる。判断が難しい場合は最も近い種別を選ぶ。

# 出力テキストの記法（各 section の text で使用）
- 空所は [[1]] [[A]]。**[[ ]] の中には英数字のみ**を入れる（[[1]] [[12]] [[A]]）。[[(1)]] のように括弧や記号を入れてはいけない。
- 選択肢は行頭に ((ラベル)) 本文 の形式。①②③ → ((1))((2))((3))、a. b. c. → ((a))((b))((c))、ア イ ウ → ((ア))((イ))((ウ)) のように、選択肢記号は必ず (()) で囲む。
- 黄ハイライト ==語==、下線 __語__、下付き ~~x~~、上付き ^^x^^、斜字 ||||語||||
- 語注・脚注・注記の扱いは特に重要。原文では本文と別に「(注) 1. canyon 峡谷 / 2. ...」のような注の一覧が欄外や末尾に置かれていることが多いが、**この一覧をそのまま行・段落・リストとして出力してはいけない**。各注は、本文中の対応する語の位置へ移して \`##語::訳##\` の形で埋め込むこと。
  - 手順: ①本文側の注番号（※1 / 注1 / *1 / (1) など）が指す語を特定する → ②その番号を削除し、語を \`##語::訳##\` で囲む → ③欄外・末尾にあった注の一覧は出力しない（訳一覧は閲覧側で自動生成されるので、残すと二重表示になる）。
  - 区切りは必ず半角コロン2つ \`::\`。全角「：」や半角1つ「:」は不可。
  - NG（やってはいけない）: 本文 \`The immune system※1 is vital.\` ＋ 別行 \`(注) ※1 immune system＝免疫システム\`
  - OK（こうする）: \`The ##immune system::免疫システム## is vital.\`（注の一覧は書かない）
- 段落番号（本文や全訳に振られた ①②… や 1 2 … の段落番号）が元の問題に付いている場合は、その段落の行頭に [1] [2] のように単角括弧で残す（例: \`[1] The quick brown fox...\`）。これは空所 [[ ]]（二重括弧）とは別物なので混同しない。元の問題に段落番号が無ければ付けない。
- 本文末などの出典・出所表記は !!!!出典: …!!!! で囲む（右寄せ・グレーで表示される）。
- 表（行と列のある表組み）は Markdown 記法で書く。1行目を見出し、2行目を区切り行 \`| --- | --- |\`、3行目以降を中身とし、各セルを \`|\` で区切る。例:
\`| 年 | 出来事 |\`
\`| --- | --- |\`
\`| 1989 | the fall of the Berlin Wall |\`
\`| 2001 | ... |\`
  セル内でパイプ文字そのものを使いたいときは \`\\|\` とエスケープする。罫線のある表は箇条書きや段落に崩さず、必ずこの表記法を使う。
- 区切り線 ----、段落間は空行

# 変換ルール（重要）
- 下線部や語句に付く小問番号 (1)(2) 等が本文中に現れる場合は、空所ではないので [[ ]] にせず、~~(1)~~ のように下付きにする（例: 下線部(1) → __…__~~(1)~~ ）。
- 「全訳」「全文和訳」「本文の訳」は省略してはいけない。種別「全訳」のセクションに全文を必ず含める。
- 全角カンマ「，」は読点「、」に統一する。

# 注意
- 図・写真・数式は文章で簡潔に補足する（例: [図] や [グラフ]）。
- OCRが不確実な箇所は推測しすぎず原文に忠実に。英文はそのまま、和文設問もそのまま書き起こす。
- universityName / year / schedule は表紙や本文から判断する（不明なら universityName は空文字、year は 0）。schedule は「前期」「後期」「全学部」等の入試方式。
- questionNumber は 1 始まりの整数。category は「長文読解」「文法」「英作文」等が分かれば記入、不明なら空文字。`;

// 出力JSONの仕様（Worker解析・外部LLM取り込みで共用）
const INGEST_JSON_SPEC = `以下のJSON形式のみで出力してください。前後に説明文やコードブロック（\`\`\`）を含めないでください。
{"universityName":"...","year":2024,"schedule":"...","questions":[{"questionNumber":1,"category":"...","sections":[{"type":"本文","text":"..."},{"type":"設問","text":"..."},{"type":"解答","text":"..."},{"type":"解説","text":"..."},{"type":"全訳","text":"..."}]}]}`;

// 外部LLM（claude.ai / ChatGPT / Gemini 等）貼り付け用の出力仕様。
// 結果を1つの \`\`\`json コードブロックに収めさせると、各サービスの画面で
// コードブロック右上の「コピー」ボタンから1クリックで全文コピーできる。
const INGEST_JSON_SPEC_FENCED = `解析結果は、下記の形のJSONを **1つの \`\`\`json コードブロックの中だけ** に出力してください。
- コードブロックは1つだけにし、その中にJSON全体（先頭の { から末尾の } まで）を入れる。
- コードブロックの前後に説明文・コメント・補足を書かない（コメントを書きたい場合もコードブロックの外に出さない）。
- こうすると ChatGPT・Claude・Gemini いずれの画面でも、コードブロック右上の「コピー」ボタンで1クリックで全文をコピーできます。
\`\`\`json
{"universityName":"...","year":2024,"schedule":"...","questions":[{"questionNumber":1,"category":"...","sections":[{"type":"本文","text":"..."},{"type":"設問","text":"..."},{"type":"解答","text":"..."},{"type":"解説","text":"..."},{"type":"全訳","text":"..."}]}]}
\`\`\``;

type Replacement = { from?: string; to?: string; regex?: boolean; flags?: string };

// テキストへ置換ルール（grep replace）を適用し、置換件数も返す。
// regex=true のときは正規表現（不正なパターンは無視）、それ以外は全件の単純置換。
function applyReplacements(text: string, rules: Replacement[]): { text: string; count: number } {
  let out = text || "";
  let count = 0;
  if (!out || !rules || !rules.length) return { text: out, count: 0 };
  for (const r of rules) {
    if (!r || !r.from) continue;
    try {
      if (r.regex) {
        const re = new RegExp(r.from, (r.flags || "g").indexOf("g") >= 0 ? (r.flags || "g") : (r.flags || "") + "g");
        const matches = out.match(re);
        if (matches) count += matches.length;
        out = out.replace(re, r.to || "");
      } else {
        const occ = out.split(r.from).length - 1;
        if (occ > 0) { count += occ; out = out.split(r.from).join(r.to || ""); }
      }
    } catch { /* 不正な正規表現は無視 */ }
  }
  return { text: out, count: count };
}

// 登録済み全問題に置換ルールを適用（dryRun=true なら件数のみ）。
async function handleBulkReplace(request: Request, env: Env, origin: string | null): Promise<Response> {
  await ensureCategoryColumn(env);
  type Body = { rules?: Replacement[]; dryRun?: boolean };
  let body: Body;
  try { body = await request.json<Body>(); } catch { return json({ message: "リクエストの解析に失敗しました。" }, 400, origin); }
  const rules = Array.isArray(body.rules) ? body.rules.filter((r) => r && r.from) : [];
  if (!rules.length) return json({ message: "置換ルールがありません。" }, 400, origin);

  const { results } = await env.DB.prepare(
    "SELECT id, problem_text, answer_text, commentary_text FROM questions"
  ).all<{ id: number; problem_text: string; answer_text: string; commentary_text: string }>();

  let occurrences = 0;
  let changedRows = 0;
  const updates: { id: number; p: string; a: string; c: string }[] = [];
  for (const row of results) {
    const rp = applyReplacements(row.problem_text || "", rules);
    const ra = applyReplacements(row.answer_text || "", rules);
    const rc = applyReplacements(row.commentary_text || "", rules);
    const total = rp.count + ra.count + rc.count;
    if (total > 0) {
      occurrences += total;
      changedRows += 1;
      updates.push({ id: row.id, p: rp.text, a: ra.text, c: rc.text });
    }
  }

  if (body.dryRun) {
    return json({ dryRun: true, occurrences, changedRows, total: results.length }, 200, origin);
  }

  for (const u of updates) {
    await env.DB.prepare(
      "UPDATE questions SET problem_text = ?, answer_text = ?, commentary_text = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(u.p, u.a, u.c, u.id).run();
  }
  return json({ occurrences, changedRows, total: results.length }, 200, origin);
}

// 取り込み用の追加プロンプトを D1 config から読む。
async function getIngestPrompt(env: Env): Promise<string> {
  try {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const pr = await env.DB.prepare("SELECT value FROM config WHERE key = 'ingest_prompt'").first<{ value: string }>();
    if (pr) { try { return JSON.parse(pr.value) || ""; } catch { /* 壊れた値は無視 */ } }
  } catch { /* config テーブル未作成等は無視 */ }
  return "";
}

// 外部LLM（claude.ai / ChatGPT / Gemini 等）に貼り付けて使う取り込みプロンプトを返す。
// Worker解析と同じ INGEST_SYSTEM ＋ ユーザー追加プロンプト ＋ 出力JSON仕様で構成する。
async function handleIngestPrompt(env: Env, origin: string | null): Promise<Response> {
  const userPrompt = await getIngestPrompt(env);
  const prompt = INGEST_SYSTEM
    + (userPrompt ? "\n\n# 追加の変換ルール（ユーザー設定）\n" + userPrompt : "")
    + "\n\n# 出力形式\n添付したPDF（または画像・テキスト）の入試問題を解析し、大問ごと・セクションごとに構造化してください。年度・大学名・方式も読み取り universityName / year / schedule に入れてください。\n\n"
    + INGEST_JSON_SPEC_FENCED;
  return json({ prompt }, 200, origin);
}

type IngestBody = {
  pdfBase64?: string;
  mediaType?: string;
  model?: string;
  hint?: { year?: number; universityName?: string; schedule?: string };
};

// Anthropic API キーの疎通確認。最小リクエスト（haiku / max_tokens:1）を投げ、
// 認証が通るかだけを確認する。キーはヘッダで受け取り保存しない。
async function handleAnthropicTest(request: Request, origin: string | null): Promise<Response> {
  const apiKey = request.headers.get("x-anthropic-key") || "";
  if (!apiKey) {
    return json({ message: "Anthropic API キーが未設定です。先にキーを入力・保存してください。" }, 400, origin);
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
  } catch {
    return json({ message: "Anthropic API への接続に失敗しました。" }, 502, origin);
  }

  if (res.ok) {
    return json({ ok: true, model: "claude-haiku-4-5" }, 200, origin);
  }

  // 認証エラー等は Anthropic のメッセージを拾って返す
  let msg = `Anthropic API エラー（${res.status}）`;
  try {
    const ed: any = await res.json();
    if (ed && ed.error && ed.error.message) msg = ed.error.message;
  } catch { /* 非JSON */ }
  if (res.status === 401) msg = "API キーが無効です（認証エラー 401）。キーを確認してください。";
  else if (res.status === 403) msg = "このキーには利用権限がありません（403）。";
  const status = res.status === 401 || res.status === 403 ? 400 : 502;
  return json({ ok: false, message: msg }, status, origin);
}

async function handleIngest(request: Request, env: Env, origin: string | null): Promise<Response> {
  const apiKey = request.headers.get("x-anthropic-key") || "";
  if (!apiKey) {
    return json({ message: "Anthropic API キーが未設定です。設定ページ →「接続設定」で登録してください。" }, 400, origin);
  }

  let body: IngestBody;
  try {
    body = await request.json<IngestBody>();
  } catch {
    return json({ message: "リクエストの解析に失敗しました。" }, 400, origin);
  }

  const pdf = body.pdfBase64 || "";
  if (!pdf) return json({ message: "PDF データがありません。" }, 400, origin);

  const model = body.model || "claude-opus-4-8";
  const hint = body.hint || {};
  const hintLines: string[] = [];
  if (hint.year) hintLines.push(`年度: ${hint.year}`);
  if (hint.universityName) hintLines.push(`大学名: ${hint.universityName}`);
  if (hint.schedule) hintLines.push(`方式: ${hint.schedule}`);
  const hintText = hintLines.length ? `\n\n参考情報（判明している場合は優先）:\n${hintLines.join("\n")}` : "";

  // ユーザー設定（追加プロンプト）を取得
  const extraPrompt = await getIngestPrompt(env);
  const system = extraPrompt
    ? INGEST_SYSTEM + "\n\n# 追加の変換ルール（ユーザー設定）\n" + extraPrompt
    : INGEST_SYSTEM;

  const payload = {
    model,
    max_tokens: 16000,
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: body.mediaType || "application/pdf", data: pdf } },
          { type: "text", text: `添付の入試問題PDFを解析し、大問ごと・セクションごとに構造化してください。${hintText}\n\n${INGEST_JSON_SPEC}` },
        ],
      },
    ],
  };

  // SSE（Server-Sent Events）でフェーズを逐次送信。
  // 1回の長いリクエスト中に「受信→解析中→整形→完了/エラー」を流し、
  // 接続維持の鼓動も送ることでタイムアウト切断を防ぐ。
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let alive = true;
      const send = (obj: unknown) => {
        if (!alive) return;
        try { controller.enqueue(enc.encode("data: " + JSON.stringify(obj) + "\n\n")); } catch { /* closed */ }
      };
      const close = () => { alive = false; try { controller.close(); } catch { /* already closed */ } };

      // 解析中の鼓動（接続維持）
      let beating = true;
      (async () => {
        while (beating) {
          await new Promise((r) => setTimeout(r, 15000));
          if (beating) send({ phase: "analyzing", heartbeat: true });
        }
      })();

      try {
        send({ phase: "received", bytes: pdf.length });
        send({ phase: "analyzing" });

        // Anthropic 自体もストリーミングで呼ぶ（非ストリーミングだと長い生成で
        // ゲートウェイが 502/504 を返すため）。テキストデルタを連結して JSON 化。
        let res: Response;
        try {
          res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({ ...payload, stream: true }),
          });
        } catch {
          beating = false;
          send({ phase: "error", message: "Anthropic API への接続に失敗しました。" });
          return close();
        }

        if (!res.ok || !res.body) {
          beating = false;
          let msg = `Anthropic API エラー（${res.status}）`;
          try { const ed: any = await res.json(); if (ed && ed.error && ed.error.message) msg = ed.error.message; } catch { /* 非JSON */ }
          send({ phase: "error", message: msg });
          return close();
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let sbuf = "";
        let text = "";
        let stopReason: string | null = null;
        let apiErr: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sbuf += dec.decode(value, { stream: true });
          const events = sbuf.split("\n\n");
          sbuf = events.pop() || "";
          for (const evt of events) {
            const dataLine = evt.split("\n").find((l) => l.indexOf("data:") === 0);
            if (!dataLine) continue;
            const ds = dataLine.slice(5).trim();
            if (!ds) continue;
            let obj: any;
            try { obj = JSON.parse(ds); } catch { continue; }
            if (obj.type === "content_block_delta" && obj.delta && obj.delta.type === "text_delta") {
              text += obj.delta.text;
              send({ phase: "analyzing", chars: text.length });
            } else if (obj.type === "message_delta" && obj.delta && obj.delta.stop_reason) {
              stopReason = obj.delta.stop_reason;
            } else if (obj.type === "error") {
              apiErr = (obj.error && obj.error.message) || "Anthropic API エラー";
            }
          }
        }
        beating = false;

        if (apiErr) { send({ phase: "error", message: apiErr }); return close(); }
        if (stopReason === "refusal") {
          send({ phase: "error", message: "解析が安全性の理由で拒否されました。別のPDFでお試しください。" });
          return close();
        }
        if (!text) {
          send({ phase: "error", message: "解析結果を取得できませんでした（出力が空でした）。" });
          return close();
        }

        send({ phase: "parsing" });
        let parsed: any;
        try {
          let jsonText = text.trim();
          const m = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (m) jsonText = m[1].trim();
          parsed = JSON.parse(jsonText);
        }
        catch { send({ phase: "error", message: "解析結果のJSONを読み取れませんでした。" }); return close(); }
        if (stopReason === "max_tokens") parsed._truncated = true;

        send({ phase: "done", result: parsed });
        close();
      } catch (e: any) {
        beating = false;
        send({ phase: "error", message: "解析中にエラーが発生しました: " + (e && e.message ? e.message : String(e)) });
        close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", ...cors(origin) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    try {
      await fixZeroQuestionNumbers(env);

      // ── GET /api/universities ──────────────────────────────────────
      if (path === "/api/universities" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM universities ORDER BY name ASC"
        ).all();
        return json({ universities: results }, 200, origin);
      }

      // ── GET /api/config ───────────────────────────────────────────
      if (path === "/api/config" && request.method === "GET") {
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        );
        const schedRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'schedules'"
        ).first<{ value: string }>();
        const yearRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'year_presets'"
        ).first<{ value: string }>();
        const titleRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'site_title'"
        ).first<{ value: string }>();
        const cssRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'markup_css'"
        ).first<{ value: string }>();
        const domainRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'custom_domain'"
        ).first<{ value: string }>();
        const subtitleRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'site_subtitle'"
        ).first<{ value: string }>();
        const categoryRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'question_categories'"
        ).first<{ value: string }>();
        const sectionTypesRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'section_types'"
        ).first<{ value: string }>();
        const ingestPromptRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'ingest_prompt'"
        ).first<{ value: string }>();
        const curYear = new Date().getFullYear();
        const defaultSchedules = ["前期","後期","一般前期","一般後期","推薦","AO","その他"];
        const defaultYears = Array.from({ length: 8 }, (_, i) => String(curYear - i));
        const defaultCategories = ["長文","文法","語彙","英作文","会話","リスニング","その他"];
        const defaultSectionTypes = ["問題", "本文", "設問", "解答", "解説", "全訳"];
        return json({
          schedules:    schedRow ? JSON.parse(schedRow.value)  : defaultSchedules,
          year_presets: yearRow  ? JSON.parse(yearRow.value)   : defaultYears,
          site_title:   titleRow ? JSON.parse(titleRow.value)  : undefined,
          markup_css:   cssRow   ? JSON.parse(cssRow.value)    : undefined,
          custom_domain: domainRow ? JSON.parse(domainRow.value) : undefined,
          site_subtitle: subtitleRow ? JSON.parse(subtitleRow.value) : undefined,
          question_categories: categoryRow ? JSON.parse(categoryRow.value) : defaultCategories,
          section_types: sectionTypesRow ? JSON.parse(sectionTypesRow.value) : defaultSectionTypes,
          ingest_prompt: ingestPromptRow ? JSON.parse(ingestPromptRow.value) : "",
        }, 200, origin);
      }

      // ── PUT /api/config ────────────────────────────────────────────
      if (path === "/api/config" && request.method === "PUT") {
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        );
        type ConfigBody = { schedules?: string[]; year_presets?: string[]; site_title?: string; markup_css?: string; custom_domain?: string; site_subtitle?: string; question_categories?: string[]; section_types?: string[]; ingest_prompt?: string };
        const body = await request.json<ConfigBody>();
        const upsert = async (key: string, val: unknown) => {
          await env.DB.prepare(
            "INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
          ).bind(key, JSON.stringify(val)).run();
        };
        if (body.schedules     !== undefined) await upsert("schedules",     body.schedules);
        if (body.year_presets  !== undefined) await upsert("year_presets",  body.year_presets);
        if (body.site_title    !== undefined) await upsert("site_title",    body.site_title);
        if (body.markup_css    !== undefined) await upsert("markup_css",    body.markup_css);
        if (body.custom_domain !== undefined) await upsert("custom_domain", body.custom_domain);
        if (body.site_subtitle !== undefined) await upsert("site_subtitle", body.site_subtitle);
        if (body.question_categories !== undefined) await upsert("question_categories", body.question_categories);
        if (body.section_types !== undefined) await upsert("section_types", body.section_types);
        if (body.ingest_prompt !== undefined) await upsert("ingest_prompt", body.ingest_prompt);
        return json({ success: true }, 200, origin);
      }

      // ── DELETE /api/universities/:id ───────────────────────────────
      const delUniMatch = path.match(/^\/api\/universities\/(\d+)$/);
      if (delUniMatch && request.method === "DELETE") {
        const uniId = Number(delUniMatch[1]);
        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS cnt FROM exams WHERE university_id = ?"
        ).bind(uniId).first<{ cnt: number }>();
        if (row && row.cnt > 0) {
          return json(
            { error: `試験が ${row.cnt} 件登録されています。先に試験を削除してください。` },
            400, origin
          );
        }
        await env.DB.prepare("DELETE FROM universities WHERE id = ?").bind(uniId).run();
        return json({ success: true }, 200, origin);
      }

      // ── GET /api/exams ─────────────────────────────────────────────
      if (path === "/api/exams" && request.method === "GET") {
        const uname = url.searchParams.get("universityName");
        const year = url.searchParams.get("year");
        const schedule = url.searchParams.get("schedule");

        let sql = `
          SELECT e.id, e.year, e.schedule, e.created_at,
                 u.name AS university_name
          FROM exams e
          JOIN universities u ON e.university_id = u.id
          WHERE 1=1`;
        const params: (string | number)[] = [];

        if (uname) { sql += " AND u.name LIKE ?"; params.push(`%${uname}%`); }
        if (year)  { sql += " AND e.year = ?";    params.push(Number(year)); }
        if (schedule) { sql += " AND e.schedule = ?"; params.push(schedule); }

        sql += " ORDER BY e.year DESC, u.name ASC";
        const { results } = await env.DB.prepare(sql).bind(...params).all();
        return json({ exams: results }, 200, origin);
      }

      // ── POST /api/exams ────────────────────────────────────────────
      if (path === "/api/exams" && request.method === "POST") {
        await ensureCategoryColumn(env);
        type QBody = { questionNumber: number; category?: string; problemText: string; answerText: string; commentaryText: string };
        type Body = { universityName: string; year: number; schedule: string; questions?: QBody[] };
        const body = await request.json<Body>();
        const { universityName, year, schedule, questions = [] } = body;

        if (!universityName || !year || !schedule) {
          return json({ error: "Missing required fields: universityName, year, schedule" }, 400, origin);
        }

        let uni = await env.DB.prepare(
          "SELECT id, name FROM universities WHERE name = ?"
        ).bind(universityName).first<{ id: number; name: string }>();

        if (!uni) {
          uni = await env.DB.prepare(
            "INSERT INTO universities (name) VALUES (?) RETURNING id, name"
          ).bind(universityName).first<{ id: number; name: string }>();
        }
        if (!uni) return json({ error: "Failed to create university" }, 500, origin);

        // 既存の試験を探すか新規作成（重複時は既存を返す）
        let exam = await env.DB.prepare(
          "INSERT INTO exams (university_id, year, schedule) VALUES (?, ?, ?) ON CONFLICT(university_id, year, schedule) DO UPDATE SET id=id RETURNING *"
        ).bind(uni.id, year, schedule).first<{ id: number }>();

        if (!exam) return json({ error: "Failed to create exam" }, 500, origin);

        const createdQuestions = [];
        for (const q of questions) {
          const created = await env.DB.prepare(`
            INSERT INTO questions (exam_id, question_number, category, problem_text, answer_text, commentary_text)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING *
          `).bind(exam.id, Math.max(1, Number(q.questionNumber) || 1), q.category || "", q.problemText || "", q.answerText || "", q.commentaryText || "").first();
          if (created) createdQuestions.push(created);
        }

        return json({ exam: { ...exam, university_name: universityName }, questions: createdQuestions }, 201, origin);
      }

      // ── POST /api/ingest（PDF自動取り込み） ────────────────────────
      if (path === "/api/ingest" && request.method === "POST") {
        return handleIngest(request, env, origin);
      }

      // ── POST /api/anthropic-test（APIキー疎通確認） ────────────────
      if (path === "/api/anthropic-test" && request.method === "POST") {
        return handleAnthropicTest(request, origin);
      }

      // ── POST /api/replace（登録データの一括置換） ──────────────────
      if (path === "/api/replace" && request.method === "POST") {
        return handleBulkReplace(request, env, origin);
      }

      // ── GET /api/ingest-prompt（外部LLM用プロンプト） ──────────────
      if (path === "/api/ingest-prompt" && request.method === "GET") {
        return handleIngestPrompt(env, origin);
      }

      // ── DELETE /api/questions/:examId/:questionNumber ──────────────
      const delQMatch = path.match(/^\/api\/questions\/(\d+)\/(\d+)$/);
      if (delQMatch && request.method === "DELETE") {
        const examId = Number(delQMatch[1]);
        const questionNumber = Number(delQMatch[2]);
        await env.DB.prepare("DELETE FROM questions WHERE exam_id = ? AND question_number = ?")
          .bind(examId, questionNumber).run();
        // 試験に大問が0件になったら試験ごと削除
        const remaining = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM questions WHERE exam_id = ?")
          .bind(examId).first<{ cnt: number }>();
        if (remaining && remaining.cnt === 0) {
          await env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(examId).run();
        }
        return json({ success: true }, 200, origin);
      }

      // ── DELETE /api/exams/:id ─────────────────────────────────────
      const examIdMatch = path.match(/^\/api\/exams\/(\d+)$/);
      if (examIdMatch && request.method === "DELETE") {
        const examId = Number(examIdMatch[1]);
        await env.DB.prepare("DELETE FROM questions WHERE exam_id = ?").bind(examId).run();
        await env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(examId).run();
        return json({ success: true }, 200, origin);
      }

      // ── PUT /api/exams/:id ────────────────────────────────────────
      const putExamMatch = examIdMatch;
      if (putExamMatch && request.method === "PUT") {
        await ensureCategoryColumn(env);
        let examId = Number(putExamMatch[1]);
        type QBody = { questionNumber: number; category?: string; problemText: string; answerText: string; commentaryText: string };
        type PutBody = { universityName?: string; year?: number; schedule?: string; questions?: QBody[] };
        const body = await request.json<PutBody>();

        const existing = await env.DB.prepare("SELECT university_id, year, schedule FROM exams WHERE id = ?")
          .bind(examId).first<{ university_id: number; year: number; schedule: string }>();
        if (!existing) return json({ error: "Exam not found" }, 404, origin);

        // 変更後の (大学・年度・方式) を確定（大学名が来ていれば取得 or 新規作成。まだ UPDATE はしない）
        let targetUniId = existing.university_id;
        if (body.universityName) {
          let uni = await env.DB.prepare("SELECT id FROM universities WHERE name = ?")
            .bind(body.universityName).first<{ id: number }>();
          if (!uni) uni = await env.DB.prepare(
            "INSERT INTO universities (name) VALUES (?) RETURNING id"
          ).bind(body.universityName).first<{ id: number }>();
          if (uni) targetUniId = uni.id;
        }
        const targetYear = body.year !== undefined ? body.year : existing.year;
        const targetSchedule = body.schedule !== undefined ? body.schedule : existing.schedule;

        if (body.questions !== undefined) {
          // DELETE ALL + INSERT の代わりに UPSERT で各大問を個別更新
          // （他の大問を消さないようにするため）
          for (const q of body.questions) {
            const qnum = Math.max(1, Number(q.questionNumber) || 1);
            await env.DB.prepare(`
              INSERT INTO questions (exam_id, question_number, category, problem_text, answer_text, commentary_text)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(exam_id, question_number) DO UPDATE SET
                category = excluded.category,
                problem_text = excluded.problem_text,
                answer_text = excluded.answer_text,
                commentary_text = excluded.commentary_text,
                updated_at = datetime('now')
            `).bind(examId, qnum, q.category || "", q.problemText || "", q.answerText || "", q.commentaryText || "").run();
          }
        }

        // 変更後の (大学・年度・方式) が別の試験と重複するか判定
        const conflict = await env.DB.prepare(
          "SELECT id FROM exams WHERE university_id = ? AND year = ? AND schedule = ? AND id != ?"
        ).bind(targetUniId, targetYear, targetSchedule, examId).first<{ id: number }>();

        let merged = false;
        if (conflict) {
          // ── 統合（マージ）: 元の試験の大問を既存の試験へ移し、空になった元を削除 ──
          const targetId = conflict.id;
          const used = await env.DB.prepare(
            "SELECT question_number FROM questions WHERE exam_id = ?"
          ).bind(targetId).all<{ question_number: number }>();
          const taken = new Set<number>(used.results.map((r) => r.question_number));
          let maxNum = taken.size ? Math.max(...taken) : 0;

          const srcQs = await env.DB.prepare(
            "SELECT id, question_number FROM questions WHERE exam_id = ? ORDER BY question_number ASC"
          ).bind(examId).all<{ id: number; question_number: number }>();

          for (const q of srcQs.results) {
            let n = q.question_number;
            if (taken.has(n)) { maxNum += 1; n = maxNum; }   // 番号が衝突したら上書きせず空き番号へずらす
            else if (n > maxNum) { maxNum = n; }
            taken.add(n);
            await env.DB.prepare("UPDATE questions SET exam_id = ?, question_number = ? WHERE id = ?")
              .bind(targetId, n, q.id).run();
          }
          // 空になった元の試験を削除し、以降は統合先を対象にする
          await env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(examId).run();
          examId = targetId;
          merged = true;
        } else {
          // 重複なし: メタ情報を通常どおり更新
          await env.DB.prepare("UPDATE exams SET university_id = ?, year = ?, schedule = ? WHERE id = ?")
            .bind(targetUniId, targetYear, targetSchedule, examId).run();
        }

        const updated = await env.DB.prepare(
          "SELECT e.id, e.year, e.schedule, u.name AS university_name FROM exams e JOIN universities u ON e.university_id = u.id WHERE e.id = ?"
        ).bind(examId).first();
        return json({ exam: updated, merged }, 200, origin);
      }

      // ── GET /api/exams/:id ─────────────────────────────────────────
      if (examIdMatch && request.method === "GET") {
        await ensureCategoryColumn(env);
        const examId = Number(examIdMatch[1]);

        const examRow = await env.DB.prepare(`
          SELECT e.id, e.year, e.schedule, e.created_at,
                 u.name AS university_name
          FROM exams e
          JOIN universities u ON e.university_id = u.id
          WHERE e.id = ?
        `).bind(examId).first();

        if (!examRow) return json({ error: "Exam not found" }, 404, origin);

        const { results: questions } = await env.DB.prepare(
          "SELECT * FROM questions WHERE exam_id = ? ORDER BY question_number ASC"
        ).bind(examId).all();

        return json({ exam: { ...examRow, questions } }, 200, origin);
      }

      // ── GET /api/corpus ────────────────────────────────────────────
      // 全入試問題の英文テキストを一括返却（クライアント側コーパス分析用）
      if (path === "/api/corpus" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT q.id AS question_id, q.question_number, q.category,
                 q.problem_text, q.answer_text, q.commentary_text,
                 e.id AS exam_id, e.year, e.schedule,
                 u.name AS university_name
          FROM questions q
          JOIN exams e ON q.exam_id = e.id
          JOIN universities u ON e.university_id = u.id
          ORDER BY e.year DESC, u.name ASC, q.question_number ASC
        `).all();
        return json({ questions: results }, 200, origin);
      }

      // ── GET /api/search ────────────────────────────────────────────
      if (path === "/api/search" && request.method === "GET") {
        const word     = url.searchParams.get("word") || "";
        const uname    = url.searchParams.get("universityName") || "";
        const year     = url.searchParams.get("year") || "";
        const schedule = url.searchParams.get("schedule") || "";
        const category = url.searchParams.get("category") || "";

        // 大問ごとに1行返す（exam_id + question_number で一意）
        let sql = `
          SELECT q.id AS question_id, q.question_number, q.category,
                 e.id AS exam_id, u.name AS university_name, e.year, e.schedule,
                 0 AS total_occurrences
          FROM questions q
          JOIN exams e ON q.exam_id = e.id
          JOIN universities u ON e.university_id = u.id
          WHERE 1=1`;
        const params: (string | number)[] = [];

        if (word) {
          const p = `%${word}%`;
          sql += " AND (q.problem_text LIKE ? OR q.answer_text LIKE ? OR q.commentary_text LIKE ?)";
          params.push(p, p, p);
        }
        if (uname)    { sql += " AND u.name LIKE ?";    params.push(`%${uname}%`); }
        if (year)     { sql += " AND e.year = ?";       params.push(Number(year)); }
        if (schedule) { sql += " AND e.schedule = ?";   params.push(schedule); }
        if (category) { sql += " AND q.category = ?";   params.push(category); }

        sql += " ORDER BY e.year DESC, u.name ASC, q.question_number ASC";

        const { results: rows } = await env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();

        // キーワード検索時のみ大問ごとの出現回数を計算
        let enriched: Record<string, unknown>[] = rows;
        if (word) {
          const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          enriched = await Promise.all(
            rows.map(async (row) => {
              const q = await env.DB.prepare(
                "SELECT problem_text, answer_text, commentary_text FROM questions WHERE id = ?"
              ).bind(row.question_id).first<{ problem_text: string; answer_text: string; commentary_text: string }>();
              const combined = q
                ? `${q.problem_text || ""} ${q.answer_text || ""} ${q.commentary_text || ""}`
                : "";
              const total_occurrences = (combined.match(regex) || []).length;
              return { ...row, total_occurrences };
            })
          );
          enriched.sort((a, b) => (b.total_occurrences as number) - (a.total_occurrences as number));
        }

        return json({ results: enriched }, 200, origin);
      }

      // ── /api/wordlists（ストップワード・レベル別語彙リストの保存） ──
      if (path.startsWith("/api/wordlists")) {
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS word_lists (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
        );

        // GET /api/wordlists?type=stop|level
        if (path === "/api/wordlists" && request.method === "GET") {
          const type = url.searchParams.get("type") || "";
          const stmt = type
            ? env.DB.prepare("SELECT id, type, name, data FROM word_lists WHERE type = ? ORDER BY id ASC").bind(type)
            : env.DB.prepare("SELECT id, type, name, data FROM word_lists ORDER BY id ASC");
          const { results } = await stmt.all<{ id: number; type: string; name: string; data: string }>();
          const lists = results.map((r) => {
            let data: unknown = null;
            try { data = JSON.parse(r.data); } catch { /* 壊れた行は null として返す */ }
            return { id: r.id, type: r.type, name: r.name, data };
          });
          return json({ lists }, 200, origin);
        }

        // POST /api/wordlists
        if (path === "/api/wordlists" && request.method === "POST") {
          type WLBody = { type: string; name: string; data?: unknown };
          const body = await request.json<WLBody>();
          if (!body.type || !body.name) {
            return json({ error: "type と name は必須です" }, 400, origin);
          }
          const created = await env.DB.prepare(
            "INSERT INTO word_lists (type, name, data) VALUES (?, ?, ?) RETURNING id, type, name"
          ).bind(body.type, body.name, JSON.stringify(body.data ?? null)).first();
          return json({ list: created }, 201, origin);
        }

        const wlMatch = path.match(/^\/api\/wordlists\/(\d+)$/);
        // PUT /api/wordlists/:id
        if (wlMatch && request.method === "PUT") {
          const id = Number(wlMatch[1]);
          type WLPut = { name?: string; data?: unknown };
          const body = await request.json<WLPut>();
          if (body.name !== undefined) {
            await env.DB.prepare("UPDATE word_lists SET name = ?, updated_at = datetime('now') WHERE id = ?")
              .bind(body.name, id).run();
          }
          if (body.data !== undefined) {
            await env.DB.prepare("UPDATE word_lists SET data = ?, updated_at = datetime('now') WHERE id = ?")
              .bind(JSON.stringify(body.data), id).run();
          }
          return json({ success: true }, 200, origin);
        }

        // DELETE /api/wordlists/:id
        if (wlMatch && request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM word_lists WHERE id = ?").bind(Number(wlMatch[1])).run();
          return json({ success: true }, 200, origin);
        }
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      console.error("Worker error:", err);
      return json({ error: "Internal server error", message: String(err) }, 500, origin);
    }
  },
};
