# Nhà trọ 25 đường 3

Trang web tối giản để người ở trọ xem **ai đang trực ngay lúc mở trang**. Giao diện trắng, thẻ có bóng nhẹ, một ít màu xanh và biểu tượng nhà/chìa khóa. Chỉ hiển thị **Mr. Tâm / Mr. Diệu**, khoảng thời gian ca và thời gian còn lại. Không có số điện thoại hay thông tin liên hệ.

## Tình trạng kết nối

- Giao diện và bộ đọc lịch đã được xây dựng, có kiểm tra tự động cho mốc đổi ca và vòng đời kết nối.
- Bảng Google Sheets gốc giữ nguyên chế độ riêng tư.
- Dự án Apps Script gắn với bảng đã được tạo, cài mã, cấu hình nguồn và quyền **chỉ đọc Google Sheets**.
- Web app Google đã được chủ tài khoản cấp quyền và triển khai thành công. `config.js` đã trỏ đến endpoint thật. Truy cập endpoint từ máy khách không đăng nhập đã trả về đúng **Mr. Diệu**, ca từ 05:30 ngày 07/11/2026 đến 05:30 ngày 08/11/2026 tại lần kiểm tra ngày 08/11/2026.
- `preview.html` là trang xem thiết kế với dòng **Bản xem trước** luôn hiển thị. Dữ liệu minh họa chỉ dùng cho trang đó.

## Quy tắc ca trực

- Múi giờ cố định: `Asia/Ho_Chi_Minh`.
- Một ca bắt đầu lúc **05:30**, kết thúc **05:30 ngày kế tiếp**.
- Trước 05:30, dùng hàng của ngày hôm trước; đúng 05:30, chuyển sang hàng ngày mới.
- Cột A: ngày `dd/MM/yyyy`. Cột B: khoảng ca như `5:30am 07/11 - 5:30am 08/11`.
- Cột C/D: đầu cột là `Anh Tâm` / `Chú Diệu` và dấu `x` chỉ người nhận ca. Tên hiển thị trên web là `Mr. Tâm` / `Mr. Diệu`.
- Mỗi hàng cần đúng một dấu `x`. Không suy diễn người trực bằng cách luân phiên ngày chẵn/lẻ.
- Thiếu lịch, trùng ngày, tên lạ hoặc dấu nhận ca không rõ ràng đều không hiện tên như một ca đã xác nhận.
- Web tải lại dữ liệu mỗi 60 giây, khi mở lại trang và khi có mạng trở lại. Dữ liệu cũ hết hiệu lực sẽ bị gỡ khỏi thẻ.

## Cấu hình Google đang sử dụng

Mở dự án **Nhà trọ 25 đường 3 — Lịch trực** từ **Tiện ích → Apps Script** trong bảng gốc. Cấu hình đã có:

1. `Mã.gs` tương ứng với `apps-script/Code.gs` trong kho mã này.
2. Manifest tương ứng với `apps-script/appsscript.json`, bật dịch vụ Google Sheets v4 và scope `spreadsheets.readonly`.
3. Script Property `ROSTER_SPREADSHEET_ID` trỏ đến bảng gốc; bộ đọc chọn tab có `sheetId = 0` và chỉ đọc các cột A:D.
4. Web app chọn **Thực thi bằng tên: Tôi** và **Người có quyền truy cập: Bất kỳ ai**.

Chủ tài khoản đã hoàn thành cấp quyền Google. URL web app đã được điền vào `endpoint` trong `config.js`. Nếu cần thay thế bằng một triển khai khác, sao chép URL có dạng `https://script.google.com/macros/s/.../exec` vào trường này rồi đẩy thay đổi lên GitHub.

Trang chính lúc này sẽ tự đọc lịch thực tế. Cần kiểm tra trang trong cửa sổ chưa đăng nhập Google: nó phải hiện đúng ca mà không yêu cầu người xem đăng nhập. Endpoint chỉ trả về ca hiện tại, không trả toàn bộ lịch, đường dẫn bảng hay thông tin liên hệ.

Nếu triển khai lại mã Apps Script, dùng **Quản lý tùy chọn triển khai → Chỉnh sửa → Phiên bản mới** để giữ URL cũ.

## Chạy tại máy

Mọi tệp giao diện đều là HTML/CSS/JavaScript thuần, không cần cài thư viện hay build. Phục vụ thư mục này bằng một máy chủ web tĩnh; mở `index.html` để xem trạng thái thật, hoặc `preview.html` để xem thiết kế.

Kiểm tra tự động bằng Node.js 20 trở lên:

```text
npm test
node --check app.js
```

## GitHub Pages

Kho mã dùng GitHub Pages để phục vụ tệp tĩnh tại thư mục gốc. Trong **Settings → Pages**, dùng **Deploy from a branch**, nhánh mặc định và thư mục **/(root)**. Mỗi lần sửa và đẩy tệp giao diện hoặc `config.js`, GitHub sẽ xuất bản lại trang.

Google Apps Script trả dữ liệu qua ContentService với một callback cố định `NhaTro25.receive` để trang tĩnh đọc được qua chuyển hướng của Google. Trang chỉ chấp nhận endpoint HTTPS của `script.google.com`, kiểm tra tên người, thời gian ca và độ mới dữ liệu. Không cần khóa API hoặc thông tin đăng nhập trong HTML.
