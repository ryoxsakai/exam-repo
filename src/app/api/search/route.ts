import { NextRequest, NextResponse } from "next/server";
import { searchByWord, getExams, getD1Config, D1Config } from "@/lib/db";

function getConfigFromRequest(req: NextRequest): D1Config | null {
  const accountId = req.headers.get("x-cf-account-id") || undefined;
  const databaseId = req.headers.get("x-cf-database-id") || undefined;
  const apiToken = req.headers.get("x-cf-api-token") || undefined;

  if (accountId && databaseId && apiToken) {
    return { accountId, databaseId, apiToken };
  }

  return getD1Config();
}

// Count occurrences of `word` in `text` (case-insensitive)
function countOccurrences(text: string, word: string): number {
  if (!text || !word) return 0;
  const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

// GET /api/search
// Query params:
//   word (required) - the search term
//   universityName (optional) - filter by university
//   year (optional) - filter by year
//   schedule (optional) - filter by schedule
//   sortBy (optional) - "frequency" (default) | "year"
export async function GET(req: NextRequest) {
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

  const { searchParams } = req.nextUrl;
  const word = searchParams.get("word") || "";
  const universityName = searchParams.get("universityName") || undefined;
  const year = searchParams.get("year") ? Number(searchParams.get("year")) : undefined;
  const schedule = searchParams.get("schedule") || undefined;
  const sortBy = (searchParams.get("sortBy") || "frequency") as "frequency" | "year";

  try {
    if (word) {
      // Word search mode
      const results = await searchByWord(word, config);

      // Apply additional filters
      let filtered = results;
      if (universityName) {
        filtered = filtered.filter((r) =>
          r.university_name.includes(universityName)
        );
      }
      if (year) {
        filtered = filtered.filter((r) => r.year === year);
      }
      if (schedule) {
        filtered = filtered.filter((r) => r.schedule === schedule);
      }

      // Sort
      if (sortBy === "year") {
        filtered = filtered.sort((a, b) => b.year - a.year);
      } else {
        // frequency sort (already sorted by DB, but re-sort by total_occurrences)
        filtered = filtered.sort(
          (a, b) =>
            (b.total_occurrences || b.question_count) -
            (a.total_occurrences || a.question_count)
        );
      }

      return NextResponse.json({
        results: filtered,
        word,
        total: filtered.length,
      });
    } else {
      // No word: just return exams with filters
      const exams = await getExams({ universityName, year, schedule }, config);

      const results = exams.map((e) => ({
        exam_id: e.id,
        university_name: e.university_name || "",
        year: e.year,
        schedule: e.schedule,
        question_count: 0,
        total_occurrences: 0,
        matching_questions: "",
      }));

      if (sortBy === "year") {
        results.sort((a, b) => b.year - a.year);
      }

      return NextResponse.json({
        results,
        word: "",
        total: results.length,
      });
    }
  } catch (error) {
    console.error("GET /api/search error:", error);
    return NextResponse.json(
      { error: "Search failed", message: String(error) },
      { status: 500 }
    );
  }
}
