# CLAUDE.md

Bộ spec regression **bền** của OpenViCloud: mọi hành vi còn đúng ở release sau có một case trong [`plan.md`](plan.md) và một spec ở đây. Quy trình (ai thêm case, ai viết spec, chạy thế nào) sống ở repo [`OpenViCloud/titan-ops`](https://github.com/OpenViCloud/titan-ops): `iteration:enhance-regression-plan` thêm case của story vào `plan.md` sau mỗi lần deploy dev; [`release:regression`](https://github.com/OpenViCloud/titan-ops/blob/main/.claude/commands/release/regression.md) viết spec cho case chưa có spec rồi chạy **hết** repo này trên staging, ở sha `release-plan.md` ghim. Bảng module và thứ tự: [README](README.md).

Repo này không có hệ thống nào để chạy: spec chạy bằng runner `titan-regression` trong cụm (manifest ở `OpenViCloud/titan-ops:gitops/regression-runner/`), không trên máy agent. CI chỉ chạy test của tooling (`selftest/`, `test_*.py`).

## Cây thư mục

```
├── README.md        # tiếng Anh: là gì, chạy thế nào, bảng module (cột Spec)
├── CLAUDE.md        # file này: luật viết spec, giả định khi chạy trên staging
├── plan.md          # mọi case: ID, kỳ vọng, nguồn
├── run-module.sh    # một module = một job runner: nạp spec, chờ .done, chép kết quả + so sha256, xoá job;
│                   #   kubeconfig là tham số đầu (staging hay dev), cli: chép binary khi BINARY_WAIT;
│                   #   output runner vào thư mục làm việc (không commit), log control-plane + incus-worker
│                   #   vào thư mục log, in `runner: … blob=<id>`; chép ảnh UI case (results/*.png) vào thư mục log
│                   #   rồi chạy check-screenshots.py
├── check-screenshots.py  # UI case (test lái trình duyệt) phải gọi screenshot vào ${RESULTS}/<ID>-; với runner.log:
│                   #   UI case ✓ phải có <ID>-*.png — python3 check-screenshots.py <module>
├── count-cases.py   # đếm ID của plan.md với dòng ✓/✘/- của các runner.log (mở rộng dải X-01..03)
├── trim-cp-log.py   # run-module.sh lọc control-plane.log: bỏ dòng info của hosting, routing, SQL command (warn/fail và log Titan giữ)
├── test_*.py        # test của ba script trên — python3 test_count_cases.py …
├── selftest/        # test của lib không cần Playwright; ngoài lib/ vì runner chép mọi file của lib/ vào e2e/ và `testMatch`
│                   #   mặc định của Playwright chạy cả *.test.ts — node --test 'selftest/*.test.ts' (Node ≥ 22.18 tự bỏ phần
│                   #   type của TypeScript, không cài gì; dạng thư mục `node --test selftest/` không chạy)
├── lib/             # helper dùng chung, nạp cùng MỌI module
│   ├── auth.ts      #   headersOf('tenant' | 'admin'): đăng nhập trong pod, lại khi token còn < 2 phút hoặc gặp 401
│   ├── api.ts       #   gọi API, Idempotency-Key, poll tới khi current đạt đích
│   ├── edge-retry.ts  # gửi lại một lần: connect timeout (mọi method, request chưa rời runner); GET gặp socket hỏng hoặc trang HTML của edge. Ghi gặp lỗi khác thì không gửi lại
│   ├── clean-up.ts  #   cleanUp(steps) cho afterAll: chạy hết mọi bước dọn, gom lỗi, ném một lần ở cuối — một lỗi mạng không để lại quota nâng
│   ├── fixtures.ts  #   tên rg-<loại>-<lượt>, chọn zone/template/tier theo env, tìm-hoặc-tạo network của lượt
│   └── local-proxy.ts  # tự bật khi URL là *.localhost (local-mac: issuer Keycloak mang cổng 8080)
└── <module>/*.spec.ts
```

## Viết spec

- Spec của case nằm ở `<module>/`, **ID trong tên test** (`test('VM-03 stop từ Running', …)`), nguồn của kỳ vọng ở comment đầu test — đọc lại code ở chỗ cột **Nguồn** của `plan.md` trỏ tới. Luật ghi nguồn ở đầu `plan.md` (nguồn duy nhất của luật này): file trong repo này ghi `file:line`; repo khác ghi `<repo>:<path>` kèm tên hàm/type/method/test, **không** số dòng (trừ ref ghim một commit), mỗi ref tự mang repo (và sha nếu ghim; không khai repo một lần cho cả mục hay cả file, không viết tắt `:<line>` nối vào ref trước); doc của titan-ops trong `plan.md` là link đầy đủ kèm `#anchor`, trong comment spec `OpenViCloud/titan-ops:docs/…#anchor`. Ref cũ còn số dòng là rủi ro chấp nhận, sửa khi chạm. Kỳ vọng không có nguồn là đoán.
- Mọi case của module có spec chạy xanh ⇒ cột **Spec** của README = `yes`. Spec mới và dòng README vào cùng PR.
- Runner nạp **phẳng** (`/specs/*.ts`): spec import helper bằng `./auth`, không `../lib/auth`. Tên file không trùng giữa `lib/` và module.
- Mọi tài nguyên test mang tên `rg-<loại>-<lượt>` (`<lượt>` = thời điểm job bắt đầu, base36); network của lượt là `rg-net-<lượt>`, module sau tìm nó theo tiền tố. Module nào tạo thì `finally` của module đó xoá — trừ network của lượt, do `network-lifecycle` xoá; module `cleanup` quét lại.
- `beta-user` có `MaxNetworks = 1` ⇒ mọi module cần network dùng chung **một** network của lượt (`fixtures.ts`); network sống từ trước của tài khoản test làm `NETWORK_QUOTA_EXCEEDED` ⇒ `smoke` báo đỏ ngay, không để module sau đỏ lan.
- Mỗi test lái trình duyệt (UI case) chụp ≥ 1 ảnh `${RESULTS}/<ID>-<gì>.png` ở điểm an toàn (form đăng nhập rỗng hoặc đã qua, không token trên màn); release commit ảnh làm evidence — §Evidence (hàng **Ảnh UI**) của `release:regression`.
- Tiền chỉ đụng `admin-test` hoặc hoá đơn seed của chính lượt đó. Ví `beta-user` là dữ liệu sống lâu — đọc, không ghi.
- Comment trong spec theo [code-comments](https://github.com/OpenViCloud/titan-ops/blob/main/docs/architecture/code-comments.md#what-a-comment-holds): không mã iteration/story, không trỏ `docs/iterations/` của titan-ops.
- Commit và PR chỉ nêu người làm: không `Co-Authored-By: Claude …`, không dòng nói code viết bằng AI (`.claude/settings.json` tắt attribution).

## Giả định khi chạy trên staging (dữ liệu sống lâu)

- Cap per-resource đọc từ hằng mặc định của `TenantQuota` (20 rule/network, 3 snapshot/VM, 3 snapshot/volume) vì không API nào đọc được. Cap volume (10) nay `GET /v1/tenant` trả ở `maxVolumes`, nhưng spec VOL-05 vẫn dùng hằng. Tenant test có cap khác ⇒ FW-04, VMS-03, VOL-05, VOL-10 đỏ có chủ ý — đọc cap bằng SQL (`L-x` của release) trước khi chạy.
- VM-15 và TEN-02 đổi quota của `beta-user`, trả lại ngay và trong `afterAll`. Pod bị giết giữa chừng ⇒ quota lệch: SMOKE-04 log quota đầu mỗi lượt để so.
- FW-02, VMS-04, VMS-05 đọc trạng thái ngay sau request: cửa sổ là tới khi worker lease lệnh (poll 2 s) cộng thời gian provider làm — đỏ ở đây phải đối chiếu log trước khi ghi FINDING.
- CAT-05 đọc `/v1/os-images` trước khi CAT-06 sync, nên cần image đã có sẵn trên cluster của zone.
- `billing/seed-invoices.sql` mỗi lượt để lại trên `admin-test` một hoá đơn `New` 900.000.000 ₫ (BIL-06) — quá hạn sau 6 ngày, cộng dồn vào công nợ của `admin-test` trong receivables.
- `admin` đổi giá một tier vài giây (ADM-06) mỗi lần chạy: trên staging cả module cần `L-x`.
- `cli` đồng ý điều khoản thay `beta-user` nếu chưa đồng ý (`POST /v1/legal/acceptance` — bản ghi lâu dài).
- NET-05 chỉ đo khi tenant đã hết chỗ network (`test.skip` kèm lý do khi còn chỗ).
