import { NextRequest, NextResponse } from "next/server";
import { getExamById, getD1Config, D1Config } from "@/lib/db";

function getConfigFromRequest(req: NextRequest): D1Config | null {
  const accountId = req.headers.get("x-cf-account-id") || undefined;
  const databaseId = req.headers.get("x-cf-database-id") || undefined;
  const apiToken = req.headers.get("x-cf-api-token") || undefined;

  if (accountId && databaseId && apiToken) {
    return { accountId, databaseId, apiToken };
  }

  return getD1Config();
}

// GET /api/exams/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const config = getConfigFromRequest(req);

  if (!config) {
    return NextResponse.json(
      {
        error: "Database not configured",
        message:
          "Please configure Cloudflare D1 credentials in the admin page or via environment variables.",
      },
      { status: 503 }
    );
  }

  const id = Number(params.id);
  if (isNaN(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid exam ID" }, { status: 400 });
  }

  try {
    const exam = await getExamById(id, config);

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    return NextResponse.json({ exam });
  } catch (error) {
    console.error(`GET /api/exams/${id} error:`, error);
    return NextResponse.json(
      { error: "Failed to fetch exam", message: String(error) },
      { status: 500 }
    );
  }
}

// PUT /api/exams/[id]
// Update questions in an exam
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const config = getConfigFromRequest(req);

  if (!config) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const id = Number(params.id);
  if (isNaN(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid exam ID" }, { status: 400 });
  }

  try {
    const body = await req.json() as {
      questions?: Array<{
        id?: number;
        questionNumber: number;
        problemText: string;
        answerText: string;
        commentaryText: string;
      }>;
    };

    const { questions = [] } = body;
    const { createQuestion, updateQuestion } = await import("@/lib/db");

    const results = [];
    for (const q of questions) {
      if (q.id) {
        const updated = await updateQuestion(
          q.id,
          {
            problemText: q.problemText,
            answerText: q.answerText,
            commentaryText: q.commentaryText,
          },
          config
        );
        results.push(updated);
      } else {
        const created = await createQuestion(
          {
            examId: id,
            questionNumber: q.questionNumber,
            problemText: q.problemText || "",
            answerText: q.answerText || "",
            commentaryText: q.commentaryText || "",
          },
          config
        );
        results.push(created);
      }
    }

    return NextResponse.json({ questions: results });
  } catch (error) {
    console.error(`PUT /api/exams/${id} error:`, error);
    return NextResponse.json(
      { error: "Failed to update exam", message: String(error) },
      { status: 500 }
    );
  }
}
