/**
 * Pharmacy OS 設定ファイル
 * 店舗ごとに変わる値はここだけ書き換えればOKです。
 * このファイルは他のすべてのJS/HTMLより先に読み込む必要があります。
 */
const PHARMACY_CONFIG = {
  // GAS（Google Apps Script）のデプロイURL
  GAS_URL: "https://script.google.com/macros/s/AKfycbx0G_CmkUYavw2DexN2G_4McSlVv7yprfuMSr4mY15de6_b6RkwvyWrh5yixaFUGk4vTA/exec",

  // 薬局名
  PHARMACY_NAME: "【練習用】あおい薬局",

  // 住所・電話・FAX（ホーム画面の「薬局情報」に表示されます）
  PHARMACY_ADDRESS: "長野県松本市里山辺12090-2",
  PHARMACY_TEL: "0263-87-5203",
  PHARMACY_FAX: "0263-87-5204",

  // 通常の営業時間（日曜=0 〜 土曜=6）。休みの日は null にします。
  OPENING_HOURS: {
    0: null,
    1: ["08:45", "18:00"],
    2: ["08:45", "18:00"],
    3: ["08:45", "18:00"],
    4: ["08:30", "16:30"],
    5: ["08:45", "18:00"],
    6: ["08:30", "13:00"]
  },

  // Googleログイン用のOAuthクライアントID
  GOOGLE_CLIENT_ID: "891093126584-adu91hage8pfhvqqi4dlr9upvnl32m69.apps.googleusercontent.com"
};
