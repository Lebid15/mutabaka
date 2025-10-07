# Fix Android App Icon Badge Not Incrementing

## 🐛 Problem
The badge counter on the Android app icon was not incrementing correctly. When receiving consecutive notifications:
- ✅ First notification: Badge shows **1** correctly
- ❌ Second notification: Badge stays at **1** instead of showing **2**
- ❌ Third notification: Badge stays at **1** instead of showing **3**

## 🔍 Root Cause Analysis
Found two critical issues causing the problem:

### 1. Race Condition in Backend (Primary Issue)
**Location:** `backend/communications/views.py`

**Problem:**
- Push notifications were sent **immediately** after creating a message
- `_total_unread_for_user()` was calculating unread count **before** the transaction was committed to the database
- Result: Backend was sending old unread count (e.g., `badge=1` instead of `badge=2`)

**Evidence:**
```python
# OLD CODE - Race condition
msg = Message.objects.create(...)
send_message_push(conv, msg, ...)  # Executes immediately, may not see new message
```

### 2. Duplicate Check Preventing Updates (Secondary Issue)
**Location:** `mobile/src/lib/appBadge.ts`

**Problem:**
- Mobile app was skipping badge updates when the new value equaled the last known value
- Combined with race condition: backend sends `badge=1`, mobile has `lastKnownCount=1`, update skipped
- Result: Badge never increments even when it should

**Evidence:**
```typescript
// OLD CODE - Preventing legitimate updates
if (sanitized === lastKnownCount) {
  return;  // Skip update
}
```

### 3. WebSocket Sending Hardcoded Values (Additional Issue)
**Location:** `backend/communications/views.py` (3 places)

**Problem:**
- WebSocket was always sending `unread_count: 1` regardless of actual unread messages
- This could override correct values from FCM push notifications

## ✅ Solution Implemented

### Backend Changes

#### 1. Use `transaction.on_commit()` for Push Notifications
**File:** `backend/communications/views.py`

Ensures push notifications are sent **AFTER** the database transaction is committed, so `_total_unread_for_user()` sees the latest message.

```python
# NEW CODE
from django.db import transaction

msg = Message.objects.create(...)

def send_push_after_commit():
    logger.info(f"🚀 [PUSH] Sending FCM push for message {msg.id} (after commit)")
    send_message_push(conv, msg, title=sender_display, body=preview_text, data={...})
    logger.info(f"✅ [PUSH] FCM push sent successfully for message {msg.id}")

transaction.on_commit(send_push_after_commit)
```

**Impact:** Push notifications now contain the **correct** unread count.

#### 2. Fix WebSocket to Send Real Unread Count
**Files:** `backend/communications/views.py` (3 locations)

```python
# OLD CODE
'unread_count': 1,  # ❌ Always hardcoded to 1

# NEW CODE
from .push import _total_unread_for_user
user_unread = _total_unread_for_user(uid)
logger.info(f"📨 [WS] Sending inbox.update to user {uid}: unread_count={user_unread}")
'unread_count': user_unread,  # ✅ Real count
```

**Impact:** WebSocket events now send accurate unread counts, preventing conflicts with FCM.

#### 3. Add Detailed Logging
**Files:** `backend/communications/views.py`, `backend/communications/push.py`

Added comprehensive logging to track:
- When push notifications are scheduled vs. sent
- Actual badge values being sent
- WebSocket unread counts

```python
logger.info(f"🔢 [PUSH] Preparing push for user {user_id}: badge_value={badge_value}, unread_count={unread}")
```

### Mobile Changes

#### 1. Remove Duplicate Check in Badge Updates
**File:** `mobile/src/lib/appBadge.ts`

```typescript
// OLD CODE
if (sanitized === lastKnownCount) {
  return;  // Skip if same value
}

// NEW CODE
// Always apply badge updates (removed duplicate check to fix badge increment issue)
// Previous code was preventing badge from updating when backend sent same value due to race condition
lastKnownCount = sanitized;
await ensureInitialized();
await applyBadge(sanitized);
```

**Impact:** Badge always updates to the value received from backend, even if it appears unchanged.

#### 2. Add Detailed Logging
**File:** `mobile/App.tsx`

```typescript
console.log('[FCM] 🔢 Badge from push:', badge);
console.log('[FCM] 🔢 Sanitized badge:', badgeCount);
console.log('[FCM] 📊 Current lastKnownCount:', getLastBadgeCount());
console.log('[FCM] 🔢 Updating badge count from', getLastBadgeCount(), 'to:', count);
console.log('[FCM] ✅ Badge count updated, new value:', getLastBadgeCount());
```

**Impact:** Can trace badge values through the entire flow for debugging.

## 📂 Files Modified

### Backend (3 files)
1. **backend/communications/views.py**
   - Added `transaction` import
   - Modified push sending in message creation (line ~1010)
   - Fixed WebSocket `unread_count` in 3 places:
     - Regular message send (line ~920)
     - Add member action (line ~1615)
     - Remove member action (line ~1705)
   - Added logging throughout

2. **backend/communications/push.py**
   - Added detailed badge logging

3. **backend/requirements.txt**
   - No changes (transaction already available in Django)

### Mobile (2 files)
1. **mobile/src/lib/appBadge.ts**
   - Removed duplicate value check
   - Added explanatory comments

2. **mobile/App.tsx**
   - Added `getLastBadgeCount` import
   - Enhanced FCM logging with before/after badge values

## 🧪 Testing Plan

### Test Case 1: Two Quick Messages
**Steps:**
1. User A sends message to User B
2. Immediately send second message
3. Check User B's app icon badge

**Expected Result:**
- Badge shows **2** ✅

### Test Case 2: Multiple Conversations
**Steps:**
1. User A sends message from conversation 1
2. User A sends message from conversation 2
3. User A sends another message from conversation 1
4. Check User B's badge

**Expected Result:**
- Badge shows **3** (total unread from all conversations) ✅

### Test Case 3: Foreground vs Background
**Steps:**
1. Test with app in foreground
2. Test with app in background
3. Test with app killed

**Expected Result:**
- Badge increments correctly in all states ✅

### Test Case 4: Opening Conversation
**Steps:**
1. User B has badge showing **3**
2. User B opens a conversation with 2 unread messages
3. Check badge

**Expected Result:**
- Badge reduces to **1** (remaining unread) ✅

## 📊 Verification Logs

After implementing this fix, you should see logs like:

**Backend:**
```
📤 Scheduling FCM push for message 123 in conversation 45
🚀 [PUSH] Sending FCM push for message 123 (after commit)
📊 User 67: unread=2, tokens=1
🔢 [PUSH] Preparing push for user 67: badge_value=2, unread_count=2
✅ [PUSH] FCM push sent successfully for message 123
📨 [WS] Sending inbox.update to user 67: unread_count=2
```

**Mobile:**
```
[FCM] 📨 Foreground message received
[FCM] 🔢 Badge from push: 2
[FCM] 🔢 Sanitized badge: 2
[FCM] 📊 Current lastKnownCount: 1
[FCM] 🔢 Updating badge count from 1 to: 2
[FCM] ✅ Badge count updated, new value: 2
```

## ⚠️ Important Notes

### Temporary Logging
The extensive logging added is for **debugging purposes only** and should be **removed or reduced** before merging to production.

**To remove logs before merge:**
1. Keep error logs (`logger.exception`)
2. Remove or comment out info/debug logs
3. Update this PR before final merge

### Platform Differences
- **iOS:** Badge counter works reliably with standard implementation
- **Android:** Depends on launcher app
  - Google Pixel launcher: ✅ Full support
  - Samsung One UI: ✅ Full support
  - Some third-party launchers: ⚠️ Limited or no badge support

### No Configuration Changes
- ✅ No changes to production domains/URLs
- ✅ No changes to Firebase configuration
- ✅ No changes to environment variables
- ✅ Safe to deploy

## 🎯 Success Criteria

- [x] Backend sends correct unread count after DB commit
- [x] WebSocket sends real unread count (not hardcoded)
- [x] Mobile applies all badge updates without skipping
- [x] Logging added for debugging
- [ ] Manual testing completed (2 quick messages → badge shows 2)
- [ ] Multiple conversation testing completed
- [ ] Foreground/background testing completed
- [ ] Screenshots/video proof attached

## 📸 Proof Required

Before closing this PR, please attach:
1. Screenshot showing badge incrementing from 1 → 2 → 3
2. Backend logs showing correct badge values sent
3. Mobile logs showing badge values received and applied
4. (Optional) Screen recording of the badge incrementing in real-time

## 🚀 Deployment Steps

1. Merge this branch to `main`
2. Deploy backend changes
3. Build and release new mobile app version
4. **Remove debug logging** in follow-up commit

## 📝 Related Issues

Fixes badge counter issue described in `BADGE_COUNTER_ISSUE_ANALYSIS.md`

---

**Branch:** `fix/mobile-badge-increment`  
**Priority:** 🔴 High (affects user experience)  
**Estimated Time to Fix:** 30-60 minutes  
**Actual Time:** ~45 minutes
