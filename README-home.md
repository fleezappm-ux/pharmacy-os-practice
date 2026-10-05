# Pharmacy OS 薬局ホーム v1

既存の日次業務入力を維持したまま、`home.html` を薬局ホームとして追加する版です。

## GitHub Pagesへアップロードするファイル

- `home.html`
- `home.css`
- `home.js`
- `index.html`
- `style.css`
- `script.js`

既存の `index.html` は日次業務入力のままです。薬局ホームのURLは次の形式です。

```text
https://fleezappm-ux.github.io/pharmacy-os/home.html
```

## GAS更新

`Code.gs` を既存GASへ貼り替え、既存デプロイを新しいバージョンへ更新します。

ホーム画面は次のGETリクエストを1回だけ実行します。

```text
GAS_URL?action=home
```

GAS内で日次記録DBを読み、次のデータをまとめて返します。

- 最新の申し送り3件
- 先月の1日平均処方箋枚数

## 現在の仮表示

- 在庫未確認アラート：在庫管理DB接続後に表示
- タスク掲示板：タスクDB接続後に表示
- 後発品割合：後発品調剤率DBのID・項目名確認後に表示
- 月次業務／薬局ステータス／意見箱：リンク先完成後に接続

## 注意

GAS WebアプリとGitHub Pagesは公開URLです。申し送りには患者氏名、処方内容、連絡先など個人を特定できる情報を入力しない運用にしてください。
