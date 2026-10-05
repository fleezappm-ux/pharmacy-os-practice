# Pharmacy OS

薬局の日次業務をスマートフォンから入力し、Google Apps Script（GAS）経由でNotionへ保存するシンプルなWebアプリです。

## 入力項目

- 日付
- 開局時間
- 処方箋枚数
- 不在時間（分）

## ファイル構成

```text
.
├── index.html
├── style.css
├── script.js
└── README.md
```

ビルド処理や外部ライブラリはありません。4ファイルを同じ階層へ配置すれば動作します。

## GitHub Pagesで公開する手順

1. GitHubでリポジトリを作成します。
2. この4ファイルをリポジトリ直下へアップロードします。
3. リポジトリの **Settings** → **Pages** を開きます。
4. **Build and deployment** のSourceを **Deploy from a branch** にします。
5. Branchを **main**、フォルダを **/(root)** にして保存します。
6. 表示されたGitHub PagesのURLへスマートフォンからアクセスします。

## GASとのデータ連携

送信先URLは `script.js` の `GAS_ENDPOINT` に固定されています。画面からURLを入力する必要はありません。

ブラウザからは、次のJSON形式を `text/plain` としてPOSTします。

```json
{
  "date": "2026-07-31",
  "openingTime": "09:00",
  "prescriptionCount": 42,
  "absenceTime": 15
}
```

GAS側では、概ね次の形で受信できます。

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  // data.date
  // data.openingTime
  // data.prescriptionCount
  // data.absenceTime
  // ここでNotion APIへの保存処理を行う

  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## GAS側の確認事項

- Webアプリとしてデプロイ済みであること
- 実行ユーザーとアクセス権が用途に合っていること
- `doPost(e)` が上記JSONを受け取れること
- Notion APIのトークンやデータベースIDはGAS側で安全に管理すること
- GASを更新した場合、必要に応じて新しいバージョンを再デプロイすること

## 保守

- GAS URLの変更: `script.js` の `GAS_ENDPOINT`
- 色の変更: `style.css` 冒頭の `:root`
- 入力項目の変更: `index.html` と `script.js` の `createPayload()`

Notion APIのシークレットは、公開されるHTMLやJavaScriptへ絶対に記載しないでください。
