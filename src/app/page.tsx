"use client";

import React, { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import SearchBar, { SearchParams } from "@/components/SearchBar";
import ExamCard, { ExamCardData } from "@/components/ExamCard";
import ExamViewer, { ExamViewerData } from "@/components/ExamViewer";
import { searchExams, getExam, getConfig, type SearchResult } from "@/lib/api";

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
  const [searchOpen, setSearchOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const v = localStorage.getItem("cf_search_open");
    return v === null ? false : v === "true";
  });

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("cf_search_open", String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

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
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Gradient accent bar */}
      <div className="h-[3px] bg-gradient-to-r from-[#4F46E5] via-[#7C3AED] to-[#22D3EE] no-print" />

      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] no-print">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <h1 className="text-base font-700 text-[#0F172A] tracking-tight">
            {siteTitle}
          </h1>
          <button
            onClick={() => {
              try { localStorage.clear(); } catch { /* ignore */ }
              window.location.reload();
            }}
            title="キャッシュをクリアして再読み込み"
            className="flex items-center gap-1.5 text-[#94A3B8] hover:text-[#64748B] text-xs transition"
          >
            <i className="fa-regular fa-rotate-right text-[11px]" />
            <span className="hidden sm:inline">キャッシュクリア</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6">
        {/* Search section */}
        <section className="mb-5 no-print">
          <button
            onClick={toggleSearch}
            className="flex items-center gap-1.5 mb-3 text-sm text-[#64748B] hover:text-[#0F172A] transition"
          >
            <i className={`fa-regular fa-chevron-down text-xs transition-transform duration-200 ${searchOpen ? "" : "-rotate-90"}`} />
            <span className="font-600">絞り込み</span>
            {!searchOpen && searchWord && (
              <span className="text-[#4F46E5] font-400 text-xs ml-0.5">「{searchWord}」</span>
            )}
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${searchOpen ? "max-h-[560px] opacity-100" : "max-h-0 opacity-0"}`}>
            <SearchBar onSearch={handleSearch} loading={loading} />
          </div>
        </section>

        {/* Error state */}
        {error && (
          <div className="mb-5 rounded-2xl border border-[#FECACA] bg-[#FFF5F5] px-5 py-4 flex items-start gap-3 no-print">
            <i className="fa-regular fa-triangle-exclamation text-[#EF4444] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[#EF4444] font-600 text-sm">エラーが発生しました</p>
              <p className="text-[#EF4444]/80 text-sm mt-0.5">{error}</p>
              {(error.includes("Worker URL") || error.includes("未設定")) && (
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-1.5 mt-2 text-[#EF4444] underline text-sm hover:text-[#DC2626]"
                >
                  <i className="fa-regular fa-gear text-xs" />
                  管理画面でWorker URLを設定してください
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Results list */}
          <div className="lg:col-span-2 no-print">
            {/* Results header */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-600 text-[#64748B]">
                {loading ? (
                  <span className="flex items-center gap-2 text-[#94A3B8]">
                    <i className="fa-solid fa-spinner fa-spin text-[#4F46E5]" />
                    検索中…
                  </span>
                ) : results.length > 0 ? (
                  <>
                    <span className="text-[#4F46E5] font-700">{results.length}</span>
                    <span className="text-[#94A3B8] font-400"> 件</span>
                    {searchWord && (
                      <span className="text-[#94A3B8] font-400 ml-1 text-xs">「{searchWord}」</span>
                    )}
                  </>
                ) : hasSearched ? (
                  <span className="text-[#94A3B8] font-400">結果なし</span>
                ) : null}
              </p>

              {/* Sort controls */}
              {results.length > 0 && searchWord && (
                <div className="flex items-center gap-0.5 bg-[#F1F5F9] rounded-xl p-0.5">
                  <button
                    onClick={() => handleSortChange("frequency")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-600 transition ${
                      sortMode === "frequency"
                        ? "bg-white text-[#4F46E5] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                        : "text-[#94A3B8] hover:text-[#64748B]"
                    }`}
                  >
                    頻度順
                  </button>
                  <button
                    onClick={() => handleSortChange("year")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-600 transition ${
                      sortMode === "year"
                        ? "bg-white text-[#4F46E5] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                        : "text-[#94A3B8] hover:text-[#64748B]"
                    }`}
                  >
                    年度順
                  </button>
                </div>
              )}
            </div>

            {/* Cards */}
            <div className="space-y-2">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-2xl border border-[#E2E8F0] p-5 animate-pulse"
                  >
                    <div className="h-4 bg-[#F1F5F9] rounded-lg w-3/4 mb-3" />
                    <div className="h-3 bg-[#F8FAFC] rounded-lg w-1/2" />
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
                <div className="text-center py-14 text-[#94A3B8]">
                  <i className="fa-regular fa-magnifying-glass text-3xl mb-3 block opacity-40" />
                  <p className="text-sm font-500">該当する問題が見つかりませんでした</p>
                  <p className="text-xs mt-1 text-[#CBD5E1]">
                    検索条件を変えてお試しください
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Exam viewer */}
          <div className="lg:col-span-3">
            {examLoading ? (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-8 text-center">
                <i className="fa-solid fa-spinner fa-spin text-[#4F46E5] text-2xl mb-3 block" />
                <p className="text-[#94A3B8] text-sm">問題を読み込み中...</p>
              </div>
            ) : selectedExam ? (
              <ExamViewer exam={selectedExam} highlightWord={searchWord} />
            ) : (
              <div className="bg-white rounded-2xl border border-dashed border-[#E2E8F0] p-12 text-center">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-[#F5F3FF] flex items-center justify-center mb-4">
                  <i className="fa-regular fa-file-lines text-[#7C3AED] text-xl" />
                </div>
                <h3 className="text-[#64748B] font-600 text-sm mb-1">問題を選択してください</h3>
                <p className="text-xs text-[#94A3B8]">
                  左のリストから問題をクリックすると内容が表示されます
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-[#E2E8F0] bg-white py-5 no-print">
        <div className="max-w-5xl mx-auto px-5 text-center">
          <p className="text-[#CBD5E1] text-xs">
            {siteTitle} &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
