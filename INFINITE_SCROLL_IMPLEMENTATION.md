# تطبيق Infinite Scroll للرسائل

## نظرة عامة
تم تطبيق ميزة **Infinite Scroll** (التمرير اللانهائي) لتحميل الرسائل القديمة تلقائياً عند وصول المستخدم لأعلى قائمة الرسائل.

## المشكلة السابقة
- كان التطبيق يحمل فقط آخر **200 رسالة** عند فتح المحادثة
- إذا كانت المحادثة تحتوي على أكثر من 200 رسالة، الرسائل القديمة لم تكن تظهر
- لا يوجد آلية لتحميل المزيد من الرسائل عند التمرير للأعلى

## الحل المطبق

### 1. التعديلات في `mobile/src/screens/ChatScreen.tsx`

#### متغيرات الحالة الجديدة:
```typescript
const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
const [hasMoreMessages, setHasMoreMessages] = useState(true);
```

- **`loadingOlderMessages`**: يتتبع حالة تحميل الرسائل القديمة لمنع الطلبات المتكررة
- **`hasMoreMessages`**: يحدد ما إذا كانت هناك رسائل أقدم متاحة للتحميل

#### دالة `loadOlderMessages`:
```typescript
const loadOlderMessages = useCallback(async () => {
  // تحقق من الشروط قبل التحميل
  if (!shouldUseBackend || loadingOlderMessages || !hasMoreMessages || !remoteMessages.length) {
    return;
  }

  try {
    setLoadingOlderMessages(true);
    
    // الحصول على أقدم رسالة حالية
    const oldestMessage = remoteMessages[0];
    const oldestId = oldestMessage.id;
    
    // طلب 50 رسالة أقدم
    const response = await fetchMessages(numericConversationId, { 
      before: oldestId, 
      limit: 50 
    });
    
    // إضافة الرسائل الجديدة في بداية القائمة
    setRemoteMessages((prev) => [...normalizedOlder, ...prev]);
    
    // تحديث hasMoreMessages إذا حصلنا على أقل من 50 رسالة
    if (olderMessages.length < 50) {
      setHasMoreMessages(false);
    }
  } catch (error) {
    console.warn('[Mutabaka] Failed to load older messages', error);
  } finally {
    setLoadingOlderMessages(false);
  }
}, [shouldUseBackend, loadingOlderMessages, hasMoreMessages, remoteMessages, numericConversationId]);
```

#### تحديثات FlatList:
```typescript
<FlatList
  // ... props أخرى
  onEndReached={loadOlderMessages}
  onEndReachedThreshold={0.5}
  ListFooterComponent={
    loadingOlderMessages ? (
      <ActivityIndicator />
    ) : !hasMoreMessages && listData.length > 0 ? (
      <Text>لا توجد رسائل أقدم</Text>
    ) : null
  }
/>
```

- **`onEndReached`**: يُستدعى عند الوصول لنهاية القائمة (في حالة inverted list، هذا يعني الأعلى)
- **`onEndReachedThreshold={0.5}`**: يبدأ التحميل عند الوصول إلى نصف المسافة المتبقية
- **`ListFooterComponent`**: يعرض مؤشر التحميل أو رسالة "لا توجد رسائل أقدم"

### 2. التعديلات في `mobile/src/services/messages.ts`

#### تحديث دالة `fetchMessages`:
```typescript
export async function fetchMessages(
  conversationId: number,
  options?: { before?: number; limit?: number }
): Promise<MessagesResponse> {
  // إذا كان هناك before parameter، استخدم endpoint المخصص
  if (options?.before !== undefined || options?.limit !== undefined) {
    const response = await request<MessageDto[]>({
      path: `conversations/${conversationId}/messages/`,
      method: 'GET',
      query: { before: options.before, limit: options.limit },
    });
    
    return {
      count: response.length,
      next: null,
      previous: null,
      results: response,
    };
  }
  
  // الحالة العادية
  return request<MessagesResponse>({
    path: 'messages/',
    method: 'GET',
    query: { conversation: conversationId },
  });
}
```

**الأسباب:**
- endpoint `/messages/` (MessageViewSet) لا يدعم `before` parameter
- endpoint `/conversations/{id}/messages/` يدعم `before` و `limit` parameters
- يتم استخدام الـ endpoint المناسب بناءً على وجود parameters

### 3. دعم Backend (موجود مسبقاً)

في `backend/communications/views.py`، endpoint المحادثة يدعم:

```python
before = request.query_params.get('before')
limit = request.query_params.get('limit')

if before:
    b = int(before)
    qs = base_qs.filter(id__lt=b).order_by('-created_at')[:limit]
    qs = qs[::-1]  # return ascending
```

## كيف يعمل

1. **التحميل الأولي**: 
   - عند فتح المحادثة، يتم تحميل آخر 200 رسالة
   - إذا كان العدد أقل من 200، يتم تعيين `hasMoreMessages = false`

2. **Infinite Scroll**:
   - عندما يمرر المستخدم للأعلى ويصل إلى `onEndReachedThreshold`
   - يتم استدعاء `loadOlderMessages`
   - يُطلب 50 رسالة أقدم من أقدم رسالة موجودة
   - تُضاف الرسائل الجديدة في بداية القائمة

3. **منع التحميل المتكرر**:
   - `loadingOlderMessages`: يمنع إطلاق طلبات متعددة في نفس الوقت
   - `hasMoreMessages`: يوقف التحميل عند الوصول لنهاية الرسائل

4. **تجربة المستخدم**:
   - يظهر مؤشر تحميل في أعلى القائمة أثناء جلب الرسائل
   - تظهر رسالة "لا توجد رسائل أقدم" عند الوصول للنهاية
   - يحافظ على موضع التمرير الحالي باستخدام `maintainVisibleContentPosition`

## الفوائد

✅ **تحميل سريع**: فقط 50 رسالة في كل مرة بدلاً من تحميل كل الرسائل  
✅ **توفير الذاكرة**: لا يتم تحميل جميع الرسائل مرة واحدة  
✅ **تجربة سلسة**: تحميل تلقائي عند التمرير بدون ضغط زر  
✅ **أداء محسّن**: تقليل حجم البيانات المنقولة  
✅ **دعم المحادثات الطويلة**: يمكن الوصول لجميع الرسائل القديمة  

## الاختبار

للتأكد من عمل الميزة:

1. افتح محادثة تحتوي على أكثر من 200 رسالة
2. مرّر للأعلى حتى نهاية الرسائل المحملة
3. سترى مؤشر التحميل يظهر تلقائياً
4. ستظهر الرسائل القديمة (50 رسالة في كل مرة)
5. استمر بالتمرير حتى تصل لرسالة "لا توجد رسائل أقدم"

## ملاحظات تقنية

- **FlatList Inverted**: القائمة معكوسة (الأحدث في الأسفل)، لذلك `onEndReached` يعمل للأعلى
- **معالجة الحالة**: يتم إعادة تعيين `hasMoreMessages` عند تحميل محادثة جديدة
- **Batch Size**: يتم تحميل 50 رسالة في كل دفعة (قابل للتعديل)
- **Error Handling**: الأخطاء يتم تسجيلها في console دون تعطيل التطبيق

## التطوير المستقبلي

محتمل:
- [ ] تحسين حجم الدفعة بناءً على سرعة الاتصال
- [ ] إضافة pull-to-refresh للرسائل الأحدث
- [ ] تخزين مؤقت للرسائل المحملة
- [ ] تحسين الأداء للمحادثات الضخمة (آلاف الرسائل)
