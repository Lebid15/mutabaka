# Testing Guide for Badge Counter Fix

## 🧪 Quick Test Checklist

### Prerequisites
1. ✅ Backend is running locally or on server
2. ✅ Mobile app installed on Android device/emulator
3. ✅ Two user accounts available for testing
4. ✅ Notifications permission granted

---

## Test 1: Basic Increment (Most Important)

**Goal:** Verify badge increments 1 → 2 → 3

**Steps:**
1. User A logs in on device 1
2. User B logs in on device 2
3. **Close or background** User B's app (important!)
4. User A sends first message to User B
5. Wait 2 seconds
6. Check User B's app icon → Should show badge **1** ✅
7. User A sends second message
8. Wait 2 seconds  
9. Check User B's app icon → Should show badge **2** ✅
10. User A sends third message
11. Wait 2 seconds
12. Check User B's app icon → Should show badge **3** ✅

**Expected Logs:**

Backend:
```
📤 Scheduling FCM push for message 101
🚀 [PUSH] Sending FCM push for message 101 (after commit)
🔢 [PUSH] Preparing push for user 2: badge_value=1, unread_count=1
✅ [PUSH] FCM push sent successfully

📤 Scheduling FCM push for message 102
🚀 [PUSH] Sending FCM push for message 102 (after commit)
🔢 [PUSH] Preparing push for user 2: badge_value=2, unread_count=2
✅ [PUSH] FCM push sent successfully

📤 Scheduling FCM push for message 103
🚀 [PUSH] Sending FCM push for message 103 (after commit)
🔢 [PUSH] Preparing push for user 2: badge_value=3, unread_count=3
✅ [PUSH] FCM push sent successfully
```

Mobile (adb logcat):
```
[FCM] 🔢 Badge from push: 1
[FCM] 🔢 Updating badge count from 0 to: 1

[FCM] 🔢 Badge from push: 2
[FCM] 🔢 Updating badge count from 1 to: 2

[FCM] 🔢 Badge from push: 3
[FCM] 🔢 Updating badge count from 2 to: 3
```

---

## Test 2: Multiple Conversations

**Goal:** Verify badge shows total unread from all conversations

**Steps:**
1. User A creates conversation 1 with User B
2. User A creates conversation 2 with User B
3. User B closes/backgrounds app
4. User A sends 1 message in conversation 1
5. Wait 2 seconds
6. Check User B's badge → Should be **1** ✅
7. User A sends 1 message in conversation 2
8. Wait 2 seconds
9. Check User B's badge → Should be **2** ✅
10. User A sends another message in conversation 1
11. Wait 2 seconds
12. Check User B's badge → Should be **3** ✅

---

## Test 3: Foreground Behavior

**Goal:** Verify badge updates when app is open

**Steps:**
1. User B has app **open** and on inbox screen
2. User A sends first message
3. Check User B's badge → Should show **1** ✅
4. User A sends second message
5. Check User B's badge → Should show **2** ✅

**Note:** Foreground uses FCM `onMessage` handler, same logic applies.

---

## Test 4: Badge Reset on Read

**Goal:** Verify badge decreases when reading messages

**Steps:**
1. User B has badge showing **3** (3 unread messages)
2. User B opens the app
3. User B opens a conversation with 2 unread messages
4. Messages are marked as read
5. User B goes back to inbox
6. Check badge → Should show **1** (remaining unread) ✅

---

## Test 5: Quick Succession (Stress Test)

**Goal:** Verify no race condition with rapid messages

**Steps:**
1. User B closes app
2. User A sends 5 messages **rapidly** (< 1 second apart)
3. Wait 5 seconds for all pushes to arrive
4. Check User B's badge → Should show **5** ✅

**What to check:**
- All 5 push notifications arrive
- Badge shows final count **5** (not intermediate values)
- No missed notifications

---

## 🔍 How to Check Logs

### Backend Logs (Django)
```bash
cd F:\mtk\backend
python manage.py runserver

# Logs will show in console
```

Look for:
- `📤 Scheduling FCM push`
- `🚀 [PUSH] Sending FCM push (after commit)`
- `🔢 [PUSH] ... badge_value=X`

### Mobile Logs (Android)

**Method 1: Metro Bundler Console**
```bash
cd F:\mtk\mobile
npx expo start

# Look for FCM logs in console
```

**Method 2: Android Logcat**
```bash
adb logcat | findstr "FCM"
```

Look for:
- `[FCM] 🔢 Badge from push: X`
- `[FCM] 🔢 Updating badge count from Y to: X`

---

## ✅ Success Criteria

All tests pass if:
- ✅ Badge increments correctly: 1 → 2 → 3 → 4 → 5
- ✅ Badge shows total unread from all conversations
- ✅ Backend logs show increasing `badge_value`
- ✅ Mobile logs show increasing badge counts
- ✅ No errors in backend or mobile logs
- ✅ No race condition (rapid messages work correctly)

---

## ❌ Known Issues

### Badge Not Showing on Some Launchers
**Problem:** Some Android launchers don't support badges

**Affected:**
- Older Android versions (< 8.0)
- Some custom launchers

**Solution:** Test on Google Pixel or Samsung devices with stock launchers

### Badge Shows Old Value
**Problem:** Badge doesn't update immediately

**Possible Causes:**
1. Push notification not arriving (check Firebase)
2. App not receiving FCM message (check logs)
3. Backend sending wrong value (check backend logs)

**Debug:**
```bash
# Check backend logs for badge_value
# Check mobile logs for received badge
# Verify both match
```

---

## 📸 Screenshot Checklist

Before marking PR as complete, capture:

1. ✅ Badge showing **1** after first message
2. ✅ Badge showing **2** after second message  
3. ✅ Badge showing **3** after third message
4. ✅ Backend logs showing `badge_value=1, 2, 3`
5. ✅ Mobile logs showing badge updates

**Optional:**
- Screen recording of badge incrementing in real-time
- Multiple screenshots showing badge at different values

---

## 🚨 If Tests Fail

### Badge Stuck at 1

**Check:**
1. Backend logs: Is `badge_value` incrementing?
   - **YES** → Problem in mobile app
   - **NO** → Problem in backend (race condition not fixed)

2. Mobile logs: Is app receiving correct badge value?
   - **YES** → Check `setAppBadgeCount` logic
   - **NO** → Check FCM delivery

### Badge Shows Wrong Number

**Check:**
1. Backend: Is `_total_unread_for_user()` calculating correctly?
2. Database: Are messages marked as unread correctly?
3. Read markers: Are `ConversationReadMarker` records up to date?

### No Badge at All

**Check:**
1. Notification permission granted?
2. FCM token registered?
3. Backend sending push notifications?
4. Android launcher supports badges?

---

## 🎯 Final Validation

Before merging:
- [ ] Test 1 passed (basic increment)
- [ ] Test 2 passed (multiple conversations)
- [ ] Test 3 passed (foreground)
- [ ] Test 4 passed (badge reset)
- [ ] Test 5 passed (quick succession)
- [ ] Screenshots captured
- [ ] Logs verified
- [ ] No errors in production

**Only merge if ALL tests pass!** ✅
