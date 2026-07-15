=====================================================
HƯỚNG DẪN SỬ DỤNG HỆ THỐNG BOT BÁN HÀNG TỰ ĐỘNG LAVIE SHOP
=====================================================

1. KHỞI ĐỘNG HỆ THỐNG
- Bật Bot Discord: Chạy lệnh `node D.js` (hoặc hệ thống đã tự động chạy nền)
- Bật Web Admin: Chạy lệnh `node local_web.js`. Sau đó mở trình duyệt truy cập vào `http://localhost:3000`

2. THIẾT LẬP MENU SHOP TRÊN DISCORD
- Truy cập vào kênh Discord bạn muốn đặt Menu mua hàng.
- Gõ lệnh: `!setup_shop`
- Bot sẽ tạo ra một bảng Menu chính. Khách hàng chỉ cần bấm vào nút "Xem Danh Mục Sản Phẩm" để bắt đầu mua sắm. Cửa sổ mua sắm là Tin nhắn ẩn, hoàn toàn riêng tư cho từng khách.

3. QUẢN LÝ MẶT HÀNG (TRÊN WEB ADMIN)
- Truy cập Tab "Quản Lý Mặt Hàng".
- Bạn có thể Thêm hoặc Xóa các gói mặt hàng (Ví dụ: Acc Trắng Thông Tin, Code Gcoin 10k, v.v...).
- Dữ liệu thêm ở đây sẽ cập nhật ngay lập tức lên Bot Discord.

4. CÁCH ĐĂNG SẢN PHẨM HÀNG LOẠT LÊN SHOP (Tab Đăng Sản Phẩm)
Bạn có thể nhập trực tiếp vào ô, hoặc chuẩn bị sẵn 1 file .txt rồi bấm nút [Tải lên từ file .txt].

▶ CẤU TRÚC 1 SẢN PHẨM (Dùng dấu gạch đứng | để chia cột):
Tài_Khoản | Mật_Khẩu | Email_Gắn_Kèm | Mô_Tả_Riêng

- Nếu bán Code: Ghi mã Code ở đầu (Không cần mật khẩu). VD: CODE_ABC_1234
- Nếu bán Acc không có Email: TK | MK
- Nếu bán Acc đầy đủ: TK | MK | Email | Mô Tả

▶ CÁCH VIẾT MÔ TẢ ĐẸP TRÊN DISCORD:
Hệ thống sẽ tự động biến mô tả của bạn thành danh sách chấm xanh (🔹) cực kỳ chuyên nghiệp.
- Dùng dấu phẩy (,) hoặc ký tự (\n) để xuống dòng.
Ví dụ nhập:
user1 | pass1 | mail@ | M4A1, AK47 VIP, Xe máy
Hoặc:
user2 | pass2 | mail@ | Chi tiết:\nSúng: 10\nXe: 2
Lên Discord sẽ hiển thị thành:
> 🔹 M4A1
> 🔹 AK47 VIP
> 🔹 Xe máy

▶ CÁCH ÚP NHIỀU ACC CÙNG LÚC (DÙNG DẤU ! ĐỂ NGĂN CÁCH):
Nếu bạn muốn xuống dòng (Enter) thoải mái ngay trong file Txt mà không sợ lỗi, hãy dùng dấu chấm than `!` để ngăn cách giữa các Acc.
Ví dụ trong file txt:
user1 | pass1 | mail1 | Súng: 1
Xe: 2
!
user2 | pass2 | mail2 | Súng: 5
Xe: 9
!

▶ QUY TẮC UP ẢNH CHO ACC TREO BÁN:
- Nếu up 100 Acc, hãy chọn 100 cái ảnh và đặt tên là 1.jpg, 2.jpg... 100.jpg.
- Quét chọn tất cả ảnh và tải lên cùng lúc.
- Hệ thống sẽ tự động tự sắp xếp ảnh 1.jpg cho Acc dòng số 1, 2.jpg cho Acc dòng số 2... Cực kỳ chính xác!

5. QUY TRÌNH KHÁCH HÀNG MUA HÀNG
- Khách bấm chọn mua -> Nhập số lượng -> Hệ thống sinh mã QR với SỐ TIỀN LẺ ĐỘC NHẤT.
- Khách dùng App Ngân hàng quét QR (không cần ghi nội dung).
- Bot kiểm tra biến động số dư trong vòng 5 phút (Cooldown).
- Thanh toán thành công: Hóa đơn QR biến thành bảng Giao dịch thành công, Đồng thời Bot gửi hàng vào Tin nhắn riêng (DM) của khách.

6. GIẢ LẬP HÓA ĐƠN (DÀNH CHO ADMIN)
- Để test thử quá trình giao hàng mà không cần chuyển khoản thật.
- Gõ lệnh trên Discord: `!fakebill <số tiền>`
Ví dụ bạn đang có 1 Hóa đơn chờ thanh toán số tiền 100.015đ -> Gõ: `!fakebill 100015`. Bot sẽ giả vờ như có tiền vào tài khoản và giao hàng luôn.

=====================================================
Chúc sếp buôn may bán đắt cùng Lavie Shop! 🚀
=====================================================
