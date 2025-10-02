# Device Linking QA Checklist

Use this table to capture the PASS/FAIL result and short notes for each scenario on both Android and iOS. Run through the flows sequentially on real devices where possible. For automated or simulator coverage, note the scope in the remarks column.

| Scenario | Android Result | iOS Result | Notes |
| --- | --- | --- | --- |
| Primary bootstrap |  |  | Verify first login on Device A becomes **primary** automatically and appears under **الأجهزة المرتبطة**. |
| Pending → Approve |  |  | Device B reaches pending screen, approval from A unlocks B immediately, PIN setup succeeds. |
| Pending → Reject |  |  | Device B is rejected from A and returns to login with no tokens created. |
| Limit = 3 + Replace |  |  | With A+B+C active, Device D triggers replace flow from A; pick a device to replace, confirm counter updates to 3/3. |
| Revoke active |  |  | Revoke an active device (e.g. B) from A, ensure further calls receive ActiveDeviceRequired (401/403) and PIN is invalidated. |
| Pending TTL expiry |  |  | Leave Device B pending until TTL elapses; B should indicate expiry and return to login with no session. |
| No-push fallback |  |  | Disable push/WebSocket; ensure polling completes approve/reject/replace flows without issues. |
| Rename |  |  | Rename a device from Settings or QA screen; refreshed lists and API responses include the new label. |
| Header enforcement |  |  | Confirm authenticated requests automatically send **X-Device-Id**; removing it manually causes middleware rejection. |
| PIN integration |  |  | After device activation, PIN flows work; after revoke, PIN unlock fails; after admin pin_epoch reset, PIN cleared locally. |

*Tip:* capture screenshots or screen recordings and link them in the Notes column when an observation needs additional context.
