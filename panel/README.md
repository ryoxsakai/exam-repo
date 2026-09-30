# Exam conversation panel

既存の Exam MCP 接続に「入試問題ブラウザー」という会話パネルを追加します。

## 利用方法

1. ChatGPT デスクトップアプリで Exam を有効にしたチャットを開きます。
2. 会話のパネル追加メニューから「入試問題ブラウザー」を選択します。
3. 大学・年度・方式・キーワードで検索し、大問を選択します。
4. 「問題」「解答」「全訳」「解説」を切り替えます。
5. 表示中の文章を選択し、「選択箇所をチャットに共有」を押します。
6. チャットの入力欄に質問を入力して送信します。

チャットから `@exam 入試問題ブラウザーを開いて` と依頼して開くこともできます。
パネルが候補に表示されない場合は、Exam 接続のツール情報を更新または再接続し、アプリを開き直してください。
パネル追加メニューの具体的な位置や名称は、デスクトップアプリのバージョンによって異なる可能性があります。

共有は `ui/update-model-context` による入力欄への添付です。
大学・年度・方式・大問番号・表示欄・選択した文字列を共有し、メッセージは自動送信しません。
再度共有すると、このパネルからの添付が置き換わります。「添付を解除」で取り消せます。

## 開発と公開

```sh
npm ci --prefix panel
npm run build --prefix panel
npm test --prefix panel
```

`panel/app.js` は既存の `assets/js/markup.js` を使用します。
SDK と CSS は `worker/panel-resource.ts` にまとめ、外部 CDN への依存を避けます。
生成ファイルは Git の管理対象外です。既存の Worker 公開ワークフローで生成・テストしてからデプロイします。
MCP サーバーの登録先、OAuth 認証、既存の問題データはそのまま使用します。

`open_question_browser` は引数 `{}` を受け付ける thread entrypoint です。
`exam_id` と `question_number` の両方を指定すると、大問を直接開けます。
`resources/read` と検索・取得は既存の認証を通し、パネルに認証情報は渡しません。
画像は同じ Worker の `/api/image/` に登録されたものを表示します。

ブラウザーによるホスト通信テストは Playwright がある環境で実行します。

```sh
node scripts/test-exam-panel.cjs --browser
```

必要に応じて `NODE_PATH` に Playwright のインストール先、`PANEL_CHROMIUM` に Chromium の実行ファイルを指定できます。
実際の ChatGPT デスクトップでの追加メニューと配置の確認は別途必要です。

仕様: https://developers.openai.com/plugins/build/extensions
