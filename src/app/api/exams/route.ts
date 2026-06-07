import { NextRequest, NextResponse } from "next/server";
import { getExams, createExam, createUniversity, getUniversities, getD1Config, D1Config } from "@/lib/db";

// Helper to get D1 config from request headers or env
function getConfigFromRequest(req: NextRequest): D1Config | null {
  // Allow config override via request headers (from admin page)
  const accountId = req.headers.get("x-cf-account-id") || undefined;
  const databaseId = req.headers.get("x-cf-database-id") || undefined;
  const apiToken = req.headers.get("x-cf-api-token") || undefined;

  if (accountId && databaseId && apiToken) {
    return { accountId, databaseId, apiToken };
  }

  return getD1Config();
}

// GET /api/exams
// Query params: universityName, year, schedule
export async function GET(req: NextRequest) {
  const config = getConfigFromRequest(req);

  if (!config) {
    return NextResponse.json(
      {
        error: "Database not configured",
        message:
          "Please configure Cloudflare D1 credentials in the admin page or via environment variables: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN",
      },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = req.nextUrl;
    const filters = {
      universityName: searchParams.get("universityName") || undefined,
      year: searchParams.get("year") ? Number(searchParams.get("year")) : undefined,
      schedule: searchParams.get("schedule") || undefined,
    };

    const exams = await getExams(filters, config);
    return NextResponse.json({ exams });
  } catch (error) {
    console.error("GET /api/exams error:", error);
    return NextResponse.json(
      { error: "Failed to fetch exams", message: String(error) },
      { status: 500 }
    );
  }
}

// POST /api/exams
// Body: { universityName, year, schedule, questions: [{ questionNumber, problemText, answerText, commentaryText }] }
export async function POST(req: NextRequest) {
  const config = getConfigFromRequest(req);

  if (!config) {
    return NextResponse.json(
      {
        error: "Database not configured",
        message: "Please configure Cloudflare D1 credentials.",
      },
      { status: 503 }
    );
  }

  try {
    const body = await req.json() as {
      universityName: string;
      year: number;
      schedule: string;
      questions?: Array<{
        questionNumber: number;
        problemText: string;
        answerText: string;
        commentaryText: string;
      }>;
    };

    const { universityName, year, schedule, questions = [] } = body;

    if (!universityName || !year || !schedule) {
      return NextResponse.json(
        { error: "Missing required fields: universityName, year, schedule" },
        { status: 400 }
      );
    }

    // Find or create university
    const universities = await getUniversities(config);
    let university = universities.find((u) => u.name === universityName);

    if (!university) {
      university = await createUniversity(universityName, config);
    }

    // Create the exam
    const exam = await createExam(
      { universityId: university.id, year, schedule },
      config
    );

    // Create questions if provided
    const createdQuestions = [];
    if (questions.length > 0) {
      const { createQuestion } = await import("@/lib/db");
      for (const q of questions) {
        const question = await createQuestion(
          {
            examId: exam.id,
            questionNumber: q.questionNumber,
            problemText: q.problemText || "",
            answerText: q.answerText || "",
            commentaryText: q.commentaryText || "",
          },
          config
        );
        createdQuestions.push(question);
      }
    }

    return NextResponse.json(
      {
        exam: { ...exam, university_name: universityName },
        questions: createdQuestions,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/exams error:", error);
    const msg = String(error);
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "An exam with this university/year/schedule combination already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create exam", message: msg },
      { status: 500 }
    );
  }
}
