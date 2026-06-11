# 医学部入試問題データベース — マークアップ記法

問題文・解答・解説テキストに使用するカスタム記法の一覧。

---

## ブロック要素

| 記法 | 説明 | 例 |
|------|------|-----|
| `{{問1}}` | 大問番号バッジ（行頭に記述、以降のテキストは同行に続く） | `{{問1}} 次の文章を読んで答えよ。` |
| `----` | 区切り線（スタイル付き `<hr>`） | `----` |
| 空行 | 段落の区切り | |

## インライン要素

| 記法 | 説明 | 例 |
|------|------|-----|
| `[[1]]` | 空所バッジ（穴埋め番号。`[[A]]` のようにアルファベットも可） | `[[1]]に入る語を答えよ` |
| `((ア))` | 選択肢ラベル（行頭に記述すると選択肢行になる） | `((ア)) 細胞膜` |
| `==text==` | 黄色ハイライト | `==重要語==` |
| `==text==:color` | カラーハイライト（color: yellow / blue / red / purple / pink / green / aqua） | `==キーワード==:blue` |
| `__text__` | 下線 | `__重要__` |
| `~~N~~` | 下付き文字（subscript） | `CO~~2~~` |
| `^^text^^` | 上付き文字（superscript） | `x^^2^^` |
| `##word::translation##` | 脚注（word に `*N` 番号付きリンク、末尾に訳語リスト） | `##osmosis::浸透##` |

## 選択肢行の書き方

行頭に `((ラベル))` を書くと選択肢行として整形される。

```
((ア)) アミノ酸
((イ)) 脂肪酸
((ウ)) グルコース
```

## 複合例

```
{{問1}} 次の文章中の空所 [[1]]〜[[3]] に入る語を答えよ。

細胞は ==細胞膜==:blue によって外部と隔てられ、
##osmosis::浸透## によって水分を調節する。
CO~~2~~ の濃度が x^^2^^ に比例するとき、
__この関係を確認せよ。__

----

((ア)) アミノ酸
((イ)) 脂肪酸
((ウ)) グルコース
((エ)) グリセロール
```

---

## Worker API（Cloudflare Worker + D1）

| エンドポイント | メソッド | 説明 |
|----------------|---------|------|
| `/api/search` | GET | 試験検索（`word`, `universityName`, `year`, `schedule`） |
| `/api/exams` | POST | 試験作成 |
| `/api/exams/:id` | GET | 試験取得 |
| `/api/exams/:id` | PUT | 試験更新 |
| `/api/exams/:id` | DELETE | 試験削除 |
| `/api/universities` | GET | 大学一覧 |
| `/api/universities/:id` | DELETE | 大学削除 |
| `/api/config` | GET | 設定取得（`schedules`, `year_presets`, `site_title`） |
| `/api/config` | PUT | 設定更新 |

Worker URL は `localStorage` の `cf_worker_url` キーに保存。未設定時は `NEXT_PUBLIC_WORKER_URL` 環境変数を参照。`https://` が付いていない場合は自動補完。

## localStorage キー一覧

| キー | 説明 |
|------|------|
| `cf_worker_url` | Cloudflare Worker の URL |
| `cf_site_title` | サイトタイトル（キャッシュ） |
| `cf_search_open` | 検索バーの開閉状態 |
| `cf_admin_tab` | 管理画面の最終タブ |
| `cf_admin_editing_id` | 管理画面で最後に編集していた試験ID |
