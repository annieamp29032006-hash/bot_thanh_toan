/**
 * txParse.js - Đọc các trường của 1 giao dịch từ Web2M (dùng chung cho Poller + Webhook).
 *
 * Web2M có nhiều format field khác nhau giữa các endpoint:
 *   - historyapimbv3:      amount, transactionID, description, transactionDate, type
 *   - historyapimbnotiv3:  amount, transactionID, description, TransactionDate, TYPE
 *   - webhook:             id, transactionID, amount, description, date, type, bank
 */

// Số tiền (có thể là chuỗi "50,000" / "50000.00")
function amountOf(tx) {
    const raw = tx.amount ?? tx.value ?? tx.money ?? tx.creditAmount ?? tx.amountIn ??
                tx.credit ?? tx.so_tien ?? tx.soTien ?? 0;
    return parseInt(String(raw).replace(/[^\d]/g, ''), 10) || 0;
}

// Mã định danh giao dịch (để chống xử lý trùng). Ưu tiên `id` (Web2M unique) rồi tới mã ngân hàng.
function idOf(tx) {
    return tx.id ?? tx.transactionID ?? tx.transactionId ?? tx.tid ?? tx.tranId ??
           tx.refNo ?? tx.ma_gd ?? tx.traceId ?? tx.reference ?? '';
}

// Loại giao dịch: "IN" (tiền vào) / "OUT" (tiền ra). Web2M dùng cả `type` và `TYPE`.
function typeOf(tx) {
    return String(tx.type ?? tx.TYPE ?? tx.direction ?? '').toUpperCase();
}

// Nội dung chuyển khoản (dùng nếu sau này khớp theo nội dung)
function descOf(tx) {
    return String(tx.description ?? tx.content ?? tx.addInfo ?? tx.comment ?? tx.noi_dung ?? '');
}

// Lấy mảng giao dịch từ response/body (poller trả `transactions`, webhook trả `data`)
function extractList(data) {
    if (!data) return [];
    if (data.momoMsg && data.momoMsg.tranList) return data.momoMsg.tranList;
    return data.transactions || data.data || [];
}

module.exports = { amountOf, idOf, typeOf, descOf, extractList };
