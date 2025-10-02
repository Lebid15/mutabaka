# Mutabaka QA Guide – Device Linking

This playbook speeds up Phase 4 validation on Android and iOS. Follow the steps below to prepare your environment, drive each scenario, and capture PASS/FAIL notes inside `docs/qa/device-linking-checklist.md`.

## 1. Bootstrapping dev or stage

1. Copy `.env.example` to `.env` inside `mobile/` and point it at the desired backend (development or staging). Ensure:
   - `EXPO_PUBLIC_APP_ENV=development` (or `staging`).
   - `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_WS_BASE_URL` resolve from your device/emulator (e.g. `http://192.168.1.10:8000/api`).
2. Start the backend (`python manage.py runserver`) and run migrations if needed.
3. From `mobile/`, install dependencies: `npm install`.

## 2. Launching QA flows quickly

The new scripts spin up Expo and open the device QA screen automatically. Keep the backend reachable from the simulator/emulator first.

```powershell
cd mobile
npm run qa:android    # launches Expo dev client + opens qa://devices on Android
npm run qa:ios        # same for iOS Simulator
```

If the Metro bundler is already running, you can rerun only the deep link:

```powershell
npx uri-scheme open qa://devices --android
# or
echo qa://devices | npx uri-scheme open - --ios
```

## 3. Driving scenarios

- **Primary bootstrap:** Log in on Device A (fresh install). The first successful login becomes the primary device and appears in Settings → الأجهزة المرتبطة.
- **Pending flows:** Log in on Device B/C. They land on Device Pending screen. Approve/Reject/Replace the device using the QA screen or Postman collection. On approval, B continues and can create a PIN.
- **Replace:** When you already have three active devices, approving a fourth prompts a replace flow. Use the QA screen’s *Replace* button to pick which device to drop.
- **Revoke & TTL:** Use the QA screen to revoke an active device and observe the other session being forced back to login. Leave a pending device idle until `USER_DEVICE_PENDING_TTL_MINUTES` elapses—Device Pending screen will refresh (polling every 15s) and show the expiry message.
- **No-push fallback:** Disable push/WS (e.g. block ports or run backend without Pusher). The Device Pending screen’s polling still reacts to approve/reject/replace responses.
- **Rename:** Rename devices from Settings (scroll down to QA card) or the QA screen and confirm both UI and `/auth/devices` API show the new label instantly.
- **Header enforcement:** Use the Postman collection, remove the `X-Device-Id` header, and verify `ActiveDeviceRequired` (401/403) appears. Re-enable the header to proceed.
- **PIN integration:** After approving a device, create a PIN (Settings → الوصول السريع). Revoke the same device and confirm the PIN unlock redirects to login. If admins bump `pin_epoch`, the device stays active but the local PIN is wiped and must be reconfigured.

Record all outcomes inside `docs/qa/device-linking-checklist.md`, marking PASS/FAIL for Android and iOS individually.

## 4. QA device debug screen

Deep link `qa://devices` (or the Settings shortcut in dev/stage builds) opens a diagnostics panel with:

- Current device ID, active/pending lists, usage counter (n/3).
- Buttons for *Create Pending*, *Approve*, *Reject*, *Replace*, *Revoke*, *Rename*, and manual *Refresh*.
- Live polling logs (12s cadence) to confirm backend responses or TTL expiry.

This screen only ships in development/staging builds or when the QA deep link is invoked, keeping production builds untouched.

## 5. Postman / Insomnia collection

Import the collection and environment from `docs/qa/`:

- `device-linking.postman_collection.json`
- `device-linking.postman_environment.json`

Set `base_url`, `access_token`, `device_id`, and optional `pending_token`. Quick actions exist for approve, reject, revoke, replace, rename, and creating a synthetic pending device.

## 6. Logs and troubleshooting

- **Mobile:** use Expo DevTools or run `npx react-native log-android` / `npx react-native log-ios`. The QA screen also mirrors API responses.
- **Backend:** tail Django logs (`python manage.py runserver 0.0.0.0:8000`) with `--verbosity 2` to see `accounts.device_service` events.
- **Filtering device events:** search for keywords `DeviceService` or `ActiveDeviceRequired` in the backend console.

## 7. Deliverables checklist

- ✅ `docs/qa/device-linking-checklist.md` to record PASS/FAIL.
- ✅ Postman collection + environment for `/api/auth/devices/*`.
- ✅ QA debug screen accessible via deep link or Settings dev card.
- ✅ `npm run qa:android` / `npm run qa:ios` helpers to launch the flows.
- ⏳ Detox smoke tests (optional) – see `docs/qa/device-linking-checklist.md` Notes if you create them later.

With these assets you can execute each scenario on physical Android/iOS devices, document results, and repeat quickly when backend or mobile changes land.
