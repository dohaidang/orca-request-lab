# Request Lab

REST client gọn nhẹ cho Orca IDE. Plugin đọc file `.http` và `.rest`, gửi request trực tiếp từ máy của bạn và hiển thị status, thời gian, dung lượng, headers cùng response body.

## Tính năng v0.1.0

- Nhiều request trong một file, phân tách bằng `###`.
- GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE và CONNECT.
- Headers cùng raw/JSON body.
- Gửi bằng nút hoặc `Ctrl+Enter`; hỗ trợ hủy và gửi lại.
- Tự định dạng JSON/XML; xem text, ảnh và thông tin dữ liệu nhị phân.
- Panel request nhanh và custom editor cho `.http`/`.rest`.
- Request đi trực tiếp từ worker cục bộ, không qua máy chủ trung gian.

## Cài đặt phát triển

1. Mở **Settings → Plugins → Development** trong Orca.
2. Chọn **Add path** và trỏ tới thư mục plugin này.
3. Duyệt quyền chạy trusted worker, sau đó bật plugin.
4. Mở panel **Request Lab**, hoặc mở file `.http`/`.rest` rồi chọn editor **Request Lab**.

File mẫu nằm tại `examples/sample.http`.

## Cú pháp

```http
# @name Read item
GET https://example.com/api/items/1
Accept: application/json

### Create item
POST https://example.com/api/items
Content-Type: application/json

{"name":"demo"}
```

Response được giới hạn ở 768 KB để giữ giao diện ổn định. Phiên bản này chưa có environment variables, auth vault, history hoặc code generation; các phần đó thuộc giai đoạn tiếp theo.

## Quyền riêng tư

Plugin không có telemetry. URL, headers và body chỉ được dùng để gửi request tới đích bạn nhập.

## Tác giả

Đỗ Hải Đăng
