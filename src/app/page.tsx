"use client";

import React, { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import SearchBar, { SearchParams } from "@/components/SearchBar";
import ExamCard, { ExamCardData } from "@/components/ExamCard";
import ExamViewer, { ExamViewerData } from "@/components/ExamViewer";
import { searchExams, getExam, getConfig, type SearchResult } from "@/lib/api";
import CustomMarkupCss from "@/components/CustomMarkupCss";

type SortMode = "frequency" | "year";

function toCardData(r: SearchResult, word: string): ExamCardData {
  return {
    exam_id: r.exam_id,
    university_name: r.university_name,
    year: r.year,
    schedule: r.schedule,
    question_count: r.question_count,
    total_occurrences: r.total_occurrences,
    matching_questions: r.matching_questions,
    searchWord: word,
  };
}

export default function Home() {
  const [results, setResults] = useState<ExamCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [selectedExam, setSelectedExam] = useState<ExamViewerData | null>(null);
  const [examLoading, setExamLoading] = useState(false);
  const [searchWord, setSearchWord] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("frequency");
  const [hasSearched, setHasSearched] = useState(false);
  const [siteTitle, setSiteTitle] = useState(() => {
    if (typeof window === "undefined") return "医学部入試問題データベース";
    return localStorage.getItem("cf_site_title") || "医学部入試問題データベース";
  });

  const handleSearch = useCallback(async (params: SearchParams) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSearchWord(params.word);
    setSelectedExamId(null);
    setSelectedExam(null);

    try {
      const data = await searchExams({
        word: params.word || undefined,
        universityName: params.universityName || undefined,
        year: params.year || undefined,
        schedule: params.schedule || undefined,
      });
      setResults(data.results.map((r) => toCardData(r, params.word)));
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    handleSearch({ universityName: "", year: "", schedule: "", word: "" });
    getConfig().then((cfg) => {
      if (cfg.site_title) {
        setSiteTitle(cfg.site_title);
        try { localStorage.setItem("cf_site_title", cfg.site_title); } catch { /* ignore */ }
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectExam = useCallback(async (examId: number) => {
    if (selectedExamId === examId) {
      setSelectedExamId(null);
      setSelectedExam(null);
      return;
    }

    setSelectedExamId(examId);
    setExamLoading(true);
    setSelectedExam(null);

    try {
      const data = await getExam(examId);
      setSelectedExam(data.exam as ExamViewerData);
    } catch (err) {
      setError(`問題の読み込みに失敗しました: ${String(err)}`);
      setSelectedExamId(null);
    } finally {
      setExamLoading(false);
    }
  }, [selectedExamId]);

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode);
    const sorted = [...results];
    if (mode === "frequency") {
      sorted.sort((a, b) => (b.total_occurrences || 0) - (a.total_occurrences || 0));
    } else {
      sorted.sort((a, b) => b.year - a.year);
    }
    setResults(sorted);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <CustomMarkupCss />
      {/* Hero Header */}
      <header className="bg-gradient-to-r from-[#1e3a5f] via-[#6b46c1] to-[#0891b2] shadow-xl no-print">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <h1 className="text-2xl sm:text-3xl font-800 text-white tracking-tight leading-tight">
            {siteTitle}
          </h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 no-print">
        {/* Search Bar */}
        <section className="mb-6">
          <SearchBar onSearch={handleSearch} loading={loading} />
        </section>

        {/* Error state */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
            <i className="fa-solid fa-triangle-exclamation text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-red-700 font-600 text-sm">エラーが発生しました</p>
              <p className="text-red-600 text-sm mt-0.5">{error}</p>
              {(error.includes("Worker URL") || error.includes("未設定")) && (
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-1.5 mt-2 text-red-700 underline text-sm hover:text-red-900"
                >
                  <i className="fa-solid fa-gear text-xs" />
                  管理画面でWorker URLを設定してください
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Results list */}
          <div className="lg:col-span-2">
            {/* Results header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-700 text-slate-700">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <i className="fa-solid fa-spinner fa-spin text-[#6b46c1]" />
                      検索中…
                    </span>
                  ) : (
                    <span>
                      {results.length > 0 ? (
                        <>
                          <span className="text-[#6b46c1] font-800">{results.length}</span>
                          <span className="text-slate-500"> 件</span>
                          {searchWord && (
                            <span className="text-slate-400 font-400 ml-1">
                              「{searchWord}」の検索結果
                            </span>
                          )}
                        </>
                      ) : hasSearched ? (
                        <span className="text-slate-400">結果なし</span>
                      ) : null}
                    </span>
                  )}
                </h2>
              </div>

              {/* Sort controls */}
              {results.length > 0 && searchWord && (
                <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-0.5">
                  <button
                    onClick={() => handleSortChange("frequency")}
                    className={`px-2.5 py-1 rounded text-xs font-600 transition ${
                      sortMode === "frequency"
                        ? "bg-[#1e3a5f] text-white"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    頻度順
                  </button>
                  <button
                    onClick={() => handleSortChange("year")}
                    className={`px-2.5 py-1 rounded text-xs font-600 transition ${
                      sortMode === "year"
                        ? "bg-[#1e3a5f] text-white"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    年度順
                  </button>
                </div>
              )}
            </div>

            {/* Cards */}
            <div className="space-y-2.5">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse"
                  >
                    <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-slate-100 rounded w-1/2" />
                  </div>
                ))
              ) : results.length > 0 ? (
                results.map((exam) => (
                  <ExamCard
                    key={exam.exam_id}
                    exam={exam}
                    onSelect={handleSelectExam}
                    selected={selectedExamId === exam.exam_id}
                  />
                ))
              ) : hasSearched ? (
                <div className="text-center py-12 text-slate-400">
                  <i className="fa-solid fa-magnifying-glass text-3xl mb-3 block opacity-30" />
                  <p className="text-sm">該当する問題が見つかりませんでした</p>
                  <p className="text-xs mt-1 text-slate-300">
                    検索条件を変えてお試しください
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Exam viewer */}
          <div className="lg:col-span-3">
            {examLoading ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-8 text-center">
                <i className="fa-solid fa-spinner fa-spin text-[#6b46c1] text-3xl mb-3 block" />
                <p className="text-slate-500 text-sm">問題を読み込み中...</p>
              </div>
            ) : selectedExam ? (
              <ExamViewer exam={selectedExam} highlightWord={searchWord} />
            ) : (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1e3a5f]/10 to-[#6b46c1]/10 flex items-center justify-center mb-4">
                  <i className="fa-regular fa-file-lines text-[#6b46c1] text-2xl" />
                </div>
                <h3 className="text-slate-600 font-600 mb-1">問題を選択してください</h3>
                <p className="text-sm text-slate-400">
                  左のリストから問題をクリックすると内容が表示されます
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-slate-200 bg-white py-6 no-print">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-xs">
            医学部入試問題データベース &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
