#!/usr/bin/env python3
"""
「外部LLM取り込み」形式のJSONファイルをフォルダごと一括で Worker API へ登録する。

対象JSON形式（1ファイル = 1試験）:
  {
    "universityName": "岩手医科",
    "year": 2012,
    "schedule": "前期",
    "questions": [
      {"questionNumber": 1, "category": "長文",
       "sections": [{"type": "本文", "text": "..."}, {"type": "設問", "text": "..."}, ...]}
    ]
  }

安全のため、登録前に Worker から既存の試験一覧を取得し、
(大学名の表記統一後の名前, 年度, 方式) が既に存在する試験はスキップする
（POST /api/exams は大問の重複 INSERT に弱いため、事前チェックで二重登録を防ぐ）。

使い方:
  # まず --dry-run で「何がアップロードされ、何がスキップされるか」だけ確認する
  python3 scripts/bulk_upload_exams.py --dir "/path/to/医学部過去問" \
      --url "https://medical-exam-worker.ryoxsakai.workers.dev" --dry-run

  # 確認できたら本実行（既定: 5件アップロードごとに30分待機）
  python3 scripts/bulk_upload_exams.py --dir "/path/to/医学部過去問" \
      --url "https://medical-exam-worker.ryoxsakai.workers.dev"

  # 間隔・件数を変えたい場合
  python3 scripts/bulk_upload_exams.py --dir "..." --url "..." \
      --batch-size 5 --interval-minutes 30

  # 途中で止めても再実行すれば安全（登録済みは自動でスキップされる）
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# worker/index.ts の normalizeUniversityName と同一ルール。
# 末尾の括弧注記（（医）等）→ 末尾の「大学」→ 無ければ「大」の順に除去。
_PAREN_SUFFIX = re.compile(r"[（(][^（）()]*[）)]\s*$")


def normalize_university_name(name: str) -> str:
    n = (name or "").strip()
    if not n:
        return n
    while True:
        n2 = _PAREN_SUFFIX.sub("", n).strip()
        if n2 == n:
            break
        n = n2
    if n.endswith("大学"):
        n = n[: -len("大学")]
    elif n.endswith("大"):
        n = n[: -len("大")]
    n = n.strip()
    return n or (name or "").strip()


def build_problem_text(sections):
    """questions[].sections[{type,text}] → problemText（{{型}} マーカー区切り）"""
    lines = []
    for sec in sections or []:
        typ = sec.get("type", "")
        text = (sec.get("text") or "").strip()
        if typ != "問題":
            lines.append("{{" + typ + "}}")
        if text:
            lines.append(text)
    return "\n\n".join(lines)


def extract_legacy(sections, typ):
    return "\n\n".join(
        (sec.get("text") or "").strip()
        for sec in (sections or [])
        if sec.get("type") == typ and (sec.get("text") or "").strip()
    )


def to_api_body(data):
    """外部LLM取り込みJSON → POST /api/exams のボディ"""
    questions = []
    for q in data.get("questions") or []:
        sections = q.get("sections") or []
        questions.append({
            "questionNumber": q.get("questionNumber", 1),
            "category": q.get("category", ""),
            "problemText": build_problem_text(sections),
            "answerText": extract_legacy(sections, "解答"),
            "commentaryText": extract_legacy(sections, "解説"),
        })
    return {
        "universityName": data.get("universityName", ""),
        "year": data.get("year"),
        "schedule": data.get("schedule", ""),
        "questions": questions,
    }


def http_get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "exam-db-bulk-upload/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def http_post_json(url, body, timeout=120):
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "exam-db-bulk-upload/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def fetch_registered_keys(base_url):
    """既存の全試験を取得し、(正規化大学名, 年度, 方式) の集合を返す"""
    data = http_get_json(base_url.rstrip("/") + "/api/exams")
    keys = set()
    for e in data.get("exams") or []:
        key = (normalize_university_name(e.get("university_name", "")), int(e.get("year") or 0), e.get("schedule", ""))
        keys.add(key)
    return keys


def find_json_files(root: Path):
    return sorted(root.rglob("*.json"))


def load_and_validate(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return None, f"JSON解析エラー: {e}"
    uni = (data.get("universityName") or "").strip()
    year = data.get("year")
    sched = (data.get("schedule") or "").strip()
    questions = data.get("questions") or []
    if not uni or not year or not sched:
        return None, f"universityName/year/schedule が不足しています（uni={uni!r} year={year!r} schedule={sched!r}）"
    if not questions:
        return None, "questions が空です"
    return data, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True, help="JSONファイルを再帰的に探すルートフォルダ（例: 医学部過去問）")
    ap.add_argument("--url", required=True, help="Worker のベースURL（例: https://xxxx.workers.dev）")
    ap.add_argument("--batch-size", type=int, default=5, help="1バッチあたりの登録件数（既定: 5）")
    ap.add_argument("--interval-minutes", type=float, default=30, help="バッチ間の待機時間（分。既定: 30）")
    ap.add_argument("--dry-run", action="store_true", help="実際には登録せず、登録/スキップの予定だけ表示する")
    args = ap.parse_args()

    root = Path(args.dir).expanduser()
    if not root.is_dir():
        print(f"エラー: フォルダが見つかりません: {root}", file=sys.stderr)
        sys.exit(1)

    files = find_json_files(root)
    if not files:
        print(f"{root} 以下に .json が見つかりませんでした。")
        return
    print(f"{len(files)} 件の .json を発見しました。既存の登録状況を確認中…")

    try:
        registered = fetch_registered_keys(args.url)
    except Exception as e:
        print(f"エラー: 既存試験一覧の取得に失敗しました: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"登録済み試験: {len(registered)} 件")

    # 事前チェック: 登録対象と、スキップ対象に振り分ける
    todo = []
    for path in files:
        data, err = load_and_validate(path)
        if err:
            print(f"[NG]   {path.name}: {err}")
            continue
        key = (normalize_university_name(data["universityName"]), int(data["year"]), data["schedule"])
        if key in registered:
            print(f"[SKIP] {path.name}: 登録済み（{key[0]} {key[1]}年 {key[2]}）")
            continue
        todo.append((path, data, key))

    print(f"\nアップロード対象: {len(todo)} 件 / スキップ: {len(files) - len(todo)} 件\n")
    if args.dry_run:
        for path, _data, key in todo:
            print(f"[DRY]  {path.name} → {key[0]} {key[1]}年 {key[2]}")
        print("\n--dry-run のため実際の登録は行っていません。")
        return
    if not todo:
        print("アップロード対象がありません。終了します。")
        return

    ok, ng = 0, 0
    batch_size = max(1, args.batch_size)
    interval_sec = max(0.0, args.interval_minutes) * 60
    for batch_start in range(0, len(todo), batch_size):
        batch = todo[batch_start:batch_start + batch_size]
        print(f"--- バッチ {batch_start // batch_size + 1}（{len(batch)}件） ---")
        for path, data, key in batch:
            body = to_api_body(data)
            try:
                result = http_post_json(args.url.rstrip("/") + "/api/exams", body)
                qcount = len(result.get("questions") or [])
                print(f"[OK]   {path.name}: {key[0]} {key[1]}年 {key[2]}（大問 {qcount} 件登録, exam_id={result.get('exam', {}).get('id')}）")
                registered.add(key)
                ok += 1
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors="replace")
                print(f"[ERR]  {path.name}: HTTP {e.code} {detail[:200]}")
                ng += 1
            except Exception as e:
                print(f"[ERR]  {path.name}: {e}")
                ng += 1
        remaining = len(todo) - (batch_start + len(batch))
        if remaining > 0 and interval_sec > 0:
            print(f"{args.interval_minutes:.0f}分待機します…（残り {remaining} 件）\n")
            time.sleep(interval_sec)

    print(f"\n完了: 登録 {ok} 件 / 失敗 {ng} 件 / スキップ {len(files) - len(todo)} 件")


if __name__ == "__main__":
    main()
