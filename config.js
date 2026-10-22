// 前端設定（不含任何機密；公開託管也安全）。
// 公司座標、半徑、定位誤差門檻不在這裡：由後端「設定」分頁提供，驗證身分後才回傳。
window.PUNCH_CONFIG = {
  // LINE Developers -> LINE Login channel -> LIFF 分頁 的 LIFF ID（格式 1234567890-AbCdEfGh）
  LIFF_ID: '2012150599-SlSFgsUI',
  // Apps Script「部署為網頁應用程式」後的網址（https://script.google.com/macros/s/.../exec）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbySpajE-ZOxt1v_gXaWXnEx0TgU0I-BpaYNqZ-QQfzqA-dcC_zNByEuHncgcpbwaCpcdA/exec',
  // 讀取定位逾時（毫秒）
  GEO_TIMEOUT_MS: 15000
};
