"use client";
// أزلنا CSS module (page.module.css) لأن التصميم الآن يعتمد كلياً على Tailwind

// قائمة احتياطية (fallback) في حال تأخر تحميل العملات من الخادم
const fallbackCurrencies = [
  { name: "دولار", code: "USD", symbol: "$" },
  { name: "يورو", code: "EUR", symbol: "€" },
  { name: "تركي", code: "TRY", symbol: "₺" },
  { name: "سوري", code: "SYP", symbol: "SP" },
];

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Pusher from 'pusher-js';
import { apiClient } from '../lib/api';
import { DEBUG_FORCE_APPEND } from '../lib/config';
import { attachPrimingListeners, tryPlayMessageSound, setRuntimeSoundUrl } from '../lib/sound';
// تنسيق وقت قصير مثل واتساب (ساعة:دقيقة)
const formatTimeShort = (iso?: string) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
// مفاتيح وتقسيم الأيام: اليوم/أمس/تاريخ كامل
const dayKeyOf = (iso?: string) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  } catch {
    return 'unknown';
  }
};
const sameCalendarDay = (a: Date, b: Date) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const dayLabelOf = (iso?: string) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    const now = new Date();
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1);
    if (sameCalendarDay(d, now)) return 'اليوم';
    if (sameCalendarDay(d, yest)) return 'أمس';
    return d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return ''; }
};
// تحويل الأرقام العربية/الفارسية إلى إنجليزية للتعامل مع parseFloat
const arabicToEnglishDigits = (s: string) =>
  s
    .replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
// تطبيع النص الرقمي
const normalizeNumberString = (raw: string) => {
  const s = arabicToEnglishDigits(raw || '')
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, '')
    .replace(/,/g, '.');
  return s.trim();
};

// استخراج معاملة من نص الرسالة المولّد من الخادم
function parseTransaction(body: string): null | { direction: 'lna'|'lkm'; amount: number; currency: string; symbol: string; note?: string } {
  try {
    const re = /^معاملة:\s*(لنا|لكم)\s*([0-9]+(?:\.[0-9]+)?)\s*([^\s]+)(?:\s*-\s*(.*))?$/u;
    const m = body.trim().match(re);
    if (!m) return null;
    const dir = m[1] === 'لنا' ? 'lna' : 'lkm';
    const amount = parseFloat(m[2]);
    const sym = m[3];
    const note = (m[4] || '').trim();
    return { direction: dir, amount: isNaN(amount) ? 0 : amount, currency: sym, symbol: sym, note: note || undefined };
  } catch { return null; }
}

function TransactionBubble({ sender, tx, createdAt }: { sender: 'current'|'other'; tx: { direction: 'lna'|'lkm'; amount: number; currency: string; symbol: string; note?: string }, createdAt?: string }) {
  const isMine = sender === 'current';
  const sign = tx.direction === 'lna' ? '+' : '-';
  // انعكاس الجهة والألوان: رسائلي يمين بخلفية المستلم السابقة، ورسائل الطرف الآخر يسار بخلفية المرسل السابقة
  const wrapClass = isMine
    ? 'self-start bg-bubbleReceived text-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm w-11/12 text-xs shadow'
    : 'self-end bg-bubbleSent text-white px-3 py-2 rounded-2xl rounded-br-sm w-11/12 text-xs shadow';
  const badgeClass = tx.direction === 'lna' ? 'bg-green-600/30 text-green-200' : 'bg-red-600/30 text-red-200';
  return (
    <div className={wrapClass}>
      <div className="flex items-center gap-2 mb-1">
        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-4 w-4 opacity-80' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M12 1v22'/>
          <path d='M5 5h14v14H5z'/>
        </svg>
        <span className="font-bold">معاملة</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] ${badgeClass}`}>{tx.direction === 'lna' ? 'لنا' : 'لكم'}</span>
      </div>
      <div className="font-semibold tabular-nums" dir="ltr">{sign} {tx.amount.toFixed(2)} {tx.symbol}</div>
      {tx.note && <div className="text-[10px] text-gray-200/90 mt-1 whitespace-pre-wrap">{tx.note}</div>}
      <div className="mt-1 text-[10px] text-gray-300 flex items-center justify-end" dir="ltr">{formatTimeShort(createdAt)}</div>
    </div>
  );
}

// مكون رأس القائمة الجانبية مع نافذة بحث ديناميكي عن المستخدمين + إنشاء محادثة
function SidebarHeaderAddContact({ onAdded, existingUsernames, currentUsername, onRefreshContacts, onSubscriptionGate }: { onAdded: (conv:any)=>void, existingUsernames: string[], currentUsername?: string, onRefreshContacts?: () => void, onSubscriptionGate?: (reason?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const fetchTimer = useRef<any>(null);
  const menuRef = useRef<HTMLDivElement|null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const triggerSearch = (q: string) => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (!q.trim()) { setResults([]); setError(null); return; }
    fetchTimer.current = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiClient.searchUsers(q.trim());
        const filtered = (Array.isArray(data) ? data : []).filter(u => u && u.username && u.username !== currentUsername);
        setResults(filtered);
      } catch (e:any) {
        setError('تعذر البحث');
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  const createConv = async (username: string) => {
    try {
      setLoading(true);
      setError(null);
      const conv = await apiClient.createConversationByUsername(username);
      onAdded && onAdded(conv);
      setOpen(false);
      setQuery('');
      setResults([]);
    } catch (e:any) {
      // رسائل ودية للقيود المرتبطة بالاشتراك
      const msg = (e && e.message) ? e.message : 'تعذر إنشاء المحادثة';
      setError(msg);
      if (e && (e.status === 403 || e.status === 401)) {
        try { onSubscriptionGate && onSubscriptionGate(msg); } catch {}
      }
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    try { localStorage.removeItem('auth_tokens_v1'); } catch {}
    window.location.href = '/';
  };

  return (
    <div className="p-3 border-b border-chatDivider bg-chatPanel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-gray-100">الدردشات</div>
          <button
            onClick={() => setOpen(o => !o)}
            className="relative group w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 text-gray-200 transition"
            title="محادثة جديدة"
          >
            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-5 w-5' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
              <path d='M12 4v16m8-8H4' />
            </svg>
          </button>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={()=> setMenuOpen(m => !m)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 text-gray-200"
            title="القائمة"
          >
            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-5 w-5' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
              <circle cx='12' cy='5' r='1'/>
              <circle cx='12' cy='12' r='1'/>
              <circle cx='12' cy='19' r='1'/>
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-2 min-w-[160px] bg-chatBg border border-chatDivider rounded-lg shadow-xl overflow-hidden z-40">
              <a href="/profile" className="block px-3 py-2 text-xs text-gray-100 hover:bg-white/5">بروفايلي</a>
              <a href="/matches" className="block px-3 py-2 text-xs text-gray-100 hover:bg-white/5">مطابقاتي</a>
              <a href="/settings" className="block px-3 py-2 text-xs text-gray-100 hover:bg-white/5">الإعدادات</a>
              <a href="/subscriptions" className="block px-3 py-2 text-xs text-gray-100 hover:bg-white/5">الاشتراك</a>
              <button onClick={() => { onRefreshContacts && onRefreshContacts(); setMenuOpen(false); }} className="w-full text-right px-3 py-2 text-xs text-gray-100 hover:bg-white/5">تحديث جهات الاتصال</button>
              <button onClick={logout} className="w-full text-right px-3 py-2 text-xs text-red-300 hover:bg-red-500/10">خروج</button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 bg-chatBg border border-chatDivider rounded-lg p-3">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e)=>{ setQuery(e.target.value); triggerSearch(e.target.value); }}
              onKeyDown={(e)=>{ if (e.key==='Enter' && query.trim()) { createConv(query.trim()); } }}
              placeholder="ابحث باسم المستخدم"
              className="flex-1 bg-chatPanel border border-chatDivider rounded px-3 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
            <button onClick={()=> triggerSearch(query)} className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-xs">بحث</button>
          </div>
          {loading && <div className="text-[11px] text-gray-400 mt-2">جاري البحث…</div>}
          {error && <div className="text-[11px] text-red-300 mt-2">{error}</div>}
          {(!loading && results.length > 0) && (
            <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-chatDivider/30">
              {results.map(u => (
                <li key={u.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <img src={u.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name||u.username||'U')}&background=0D8ABC&color=fff`} className="w-8 h-8 rounded-full border border-chatDivider" />
                    <div className="text-xs text-gray-100">{u.display_name || u.username}</div>
                  </div>
                  <button onClick={()=> createConv(u.username)} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-gray-100 text-[11px]">بدء محادثة</button>
                </li>
              ))}
            </ul>
          )}
          {(!loading && results.length === 0 && query.trim()) && (
            <div className="text-[11px] text-gray-400 mt-2">لا نتائج</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const scrollRef = useRef<HTMLDivElement|null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [identifier, setIdentifier] = useState('admin');
  const [password, setPassword] = useState('');
  const [isAuthed, setIsAuthed] = useState(false);
  const [authStatus, setAuthStatus] = useState<'checking'|'authed'|'guest'>('checking');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number|null>(null);
  const [contacts, setContacts] = useState<any[]>([]); // derived from conversations (other participant)
  const [pinnedIds, setPinnedIds] = useState<number[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('pinned_conversations_v1')||'[]')||[]; } catch { return []; }
  });
  useEffect(()=>{ try { localStorage.setItem('pinned_conversations_v1', JSON.stringify(pinnedIds)); } catch {} }, [pinnedIds]);
  // meta لتحديد user_a/user_b لكل محادثة لعكس الإشارة حسب منظور المستخدم الحالي
  const [convMetaById, setConvMetaById] = useState<Record<number, { user_a_id:number; user_b_id:number }>>({});
  const [profile, setProfile] = useState<any|null>(null);
  const [openMenuForConvId, setOpenMenuForConvId] = useState<number|null>(null);
  const [muteBusyFor, setMuteBusyFor] = useState<number|null>(null);
  const [confirmDialog, setConfirmDialog] = useState<null | { open: boolean; kind: 'clear'|'delete'; convId: number }>(null);
  const [showSubBanner, setShowSubBanner] = useState(false);
  const [subBannerMsg, setSubBannerMsg] = useState<string|undefined>(undefined);

  // أرصدة المحافظ (مثال مبدئي: هذا المستخدم هو "أحمد" ويرى أرصدته بالموجب وما يستلمه بالموجب وما يرسله بالسالب)
  const initialWallet = { USD: 0, TRY: 0, EUR: 0, SYP: 0 };
  const [wallet, setWallet] = useState(initialWallet); // محفظة المستخدم الحالي (عامة - سنوقف استخدامها للعرض)
  const [counterpartyWallet, setCounterpartyWallet] = useState(initialWallet); // محفظة الطرف الآخر (عامة - سنوقف استخدامها للعرض)
  // محفظة زوجية لكل محادثة: balances من منظور المستخدم الحالي فقط
  // pairWalletByConv[conversationId] = { [currencyCode]: number }
  const [pairWalletByConv, setPairWalletByConv] = useState<Record<number, Record<string, number>>>({});
  const getPairWallet = (convId: number | null) => {
    if (!convId) return initialWallet;
    return pairWalletByConv[convId] || initialWallet;
  };
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [amountOurs, setAmountOurs] = useState(''); // لنا
  const [amountYours, setAmountYours] = useState(''); // لكم
  type ChatItem = { id?: number; client_id?: string; sender: 'current' | 'other'; text: string; created_at?: string; kind?: 'text'|'transaction'|'system'; tx?: { direction: 'lna'|'lkm'; amount: number; currency: string; symbol: string; note?: string }; status?: 'sending'|'sent'|'delivered'|'read'; attachment?: { url?: string|null; name?: string; mime?: string; size?: number|null } };
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const lastMessageIdRef = useRef<number>(0);
  const lastReadAnnounceRef = useRef<number>(0);
  const [ws, setWs] = useState<WebSocket|null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [summary, setSummary] = useState<any[]|null>(null);
  const [netBalance, setNetBalance] = useState<any[]|null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [outgoingText, setOutgoingText] = useState('');
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);
  const lastTypingSentRef = useRef<number>(0);
  const [txLoading, setTxLoading] = useState(false); // حالة إرسال المعاملة
  const [toasts, setToasts] = useState<{ id:number; type:'success'|'error'|'info'; msg:string }[]>([]);
  const pushToast = (t: {type:'success'|'error'|'info'; msg:string}) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, ...t }]);
    setTimeout(()=> setToasts(prev => prev.filter(x=>x.id!==id)), 3500);
  };
  // مرفق قيد الانتظار (يُرسل فقط عند الضغط على سهم الإرسال)
  const [pendingAttachment, setPendingAttachment] = useState<File|null>(null);
  const [pendingCurrencies, setPendingCurrencies] = useState<Set<string>>(new Set());
  // Lightbox للصور
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const buildImageItems = () => {
    try {
      return messages
        .filter(m => !!m.attachment && !!m.attachment.url && !!m.attachment.mime && m.attachment.mime.startsWith('image/'))
        .map(m => ({ url: m.attachment!.url as string, name: m.attachment!.name || 'image' }));
    } catch { return [] as {url:string; name?:string}[]; }
  };
  const openImageAt = (url: string) => {
    const items = buildImageItems();
    const idx = items.findIndex(it => it.url === url);
    if (idx >= 0) { setLightboxIndex(idx); setLightboxOpen(true); }
  };
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightboxOpen(false); }
      if (e.key === 'ArrowLeft') { setLightboxIndex(i => Math.max(0, i - 1)); }
      if (e.key === 'ArrowRight') { const len = buildImageItems().length; setLightboxIndex(i => Math.min(len - 1, i + 1)); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxOpen, messages]);
  // قائمة العملات من الخادم
  const [serverCurrencies, setServerCurrencies] = useState<any[]>([]);
  const currencyIdByCode = (code:string) => {
    const c = serverCurrencies.find((c:any)=> c.code === code);
    return c ? c.id : undefined;
  };
  const currencyCodes = () => (serverCurrencies.length ? serverCurrencies.map((c:any)=>c.code) : Object.keys(initialWallet));
  // إرسال عبر Pusher HTTP API
  const sendChat = async () => {
    if (!selectedConversationId) return;
    // إذا كان هناك مرفق قيد الانتظار، أرسله (مع التسمية التوضيحية إن وُجدت)
    if (pendingAttachment) {
      const f = pendingAttachment;
      const caption = outgoingText.trim();
      // أضف فقاعة تفاؤلية للمرفق
      const clientId = `attach_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const previewText = caption || f.name;
      setMessages(prev => [...prev, { sender: 'current', text: previewText, client_id: clientId, status: 'sending', kind: 'text', attachment: { name: f.name, mime: f.type, size: f.size } }]);
      const doUpload = async (maybeOtp?: string) => {
        try {
          const res = await apiClient.uploadConversationAttachment(selectedConversationId, f, caption || undefined, maybeOtp);
          setMessages(prev => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              const m = copy[i];
              if (m.client_id === clientId) {
                copy[i] = { ...m, id: res.id, status: 'delivered', attachment: { url: res.attachment_url || null, name: res.attachment_name, mime: res.attachment_mime, size: res.attachment_size } } as any;
                break;
              }
            }
            return copy;
          });
          // نظّف الحقول بعد النجاح
          setPendingAttachment(null);
          setOutgoingText('');
        } catch (err:any) {
          if (err && err.otp_required) {
            const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز المصادقة الثنائية (OTP)') : '';
            if (code) return doUpload(code);
          } else if (err && (err.status === 403 || err.status === 401)) {
            setSubBannerMsg(err.message || 'حسابك بحاجة لاشتراك نشط. يمكنك مراسلة الأدمن فقط.');
            setShowSubBanner(true);
          }
          setMessages(prev => prev.map(m => m.client_id === clientId ? { ...m, status: 'sent' } as any : m));
          pushToast({ type: 'error', msg: err?.message || 'فشل رفع الملف' });
        }
      };
      await doUpload();
      return;
    }

    // بدون مرفق: أرسل كنص عادي إذا كان هناك نص
    if (!outgoingText.trim()) return;
    const text = outgoingText.trim();
    setOutgoingText('');
    const clientId = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setMessages(prev => [...prev, { sender: 'current', text, client_id: clientId, status: 'sending', kind: 'text' }]);
    try {
      try {
        await apiClient.sendMessage(selectedConversationId, text);
      } catch (err:any) {
        if (err && err.otp_required) {
          const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز التحقق (OTP) لإرسال الرسالة') : '';
          if (!code) throw err;
          await apiClient.sendMessage(selectedConversationId, text, code);
        } else if (err && (err.status === 403 || err.status === 401)) {
          setSubBannerMsg(err.message || 'حسابك بحاجة لاشتراك نشط. يمكنك مراسلة الأدمن فقط.');
          setShowSubBanner(true);
          throw err;
        } else {
          throw err;
        }
      }
      setMessages(prev => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].sender === 'current' && copy[i].status === 'sending' && copy[i].text === text) {
            copy[i] = { ...copy[i], status: 'delivered', created_at: copy[i].created_at || new Date().toISOString() } as any;
            break;
          }
        }
        return copy;
      });
    } catch (e:any) {
      pushToast({ type: 'error', msg: e?.message || 'تعذر إرسال الرسالة' });
    }
  };
  // إرسال حالة الكتابة عبر WS عند الكتابة في الحقل
  const onChangeOutgoing = (val: string) => {
    setOutgoingText(val);
    const now = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN && now - lastTypingSentRef.current > 1200) {
      try { ws.send(JSON.stringify({ type: 'typing', state: 'start' })); lastTypingSentRef.current = now; } catch {}
    }
  };
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'list'>('list'); // عرض قائمة الدردشات أولاً على الجوال
  const [currentContactIndex, setCurrentContactIndex] = useState<number|null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement|null>(null);
  const currentContact = currentContactIndex !== null ? contacts[currentContactIndex] : null;
  const [lastSeenMessageId, setLastSeenMessageId] = useState<number | null>(null);
  const [unreadDividerId, setUnreadDividerId] = useState<number | null>(null);
  const [showSidebar, setShowSidebar] = useState(false); // إظهار/إخفاء القائمة على الموبايل
  const [noteText, setNoteText] = useState('');
  const [txPanelCollapsed, setTxPanelCollapsed] = useState(false);
  const contactsSigRef = useRef<string>('');
  const [pendingDeleteByConv, setPendingDeleteByConv] = useState<Record<number, { from: string; at: string }>>({});
  const [unreadByConv, setUnreadByConv] = useState<Record<number, number>>({});
  const totalUnread = useMemo(() => Object.values(unreadByConv).reduce((a,b)=>a+(b||0), 0), [unreadByConv]);
  const [unreadRestored, setUnreadRestored] = useState(false);
  // بحث داخل المحادثة الحالية
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query) return text;
    try {
      const re = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      const parts = text.split(re);
      return parts.map((part, idx) => (
        idx % 2 === 1
          ? <span key={idx} className="bg-yellow-300/30 rounded px-0.5">{part}</span>
          : <span key={idx}>{part}</span>
      ));
    } catch { return text; }
  };

  // Manual refresh of conversations/contacts mapping
  const refreshContacts = async () => {
    try {
      const convArr = await apiClient.listConversations();
      setConversations(convArr);
      const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
      for (const c of convArr) {
        if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
      }
      setConvMetaById(meta);
      const mapped = convArr.map((c: any) => {
        const meId = profile?.id;
        let other = c.user_a;
        if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
        return {
          id: c.id,
          otherUserId: other?.id,
          otherUsername: other?.username,
          name: other?.display_name || other?.username || other?.email || 'مستخدم',
          avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`,
          last_message_at: c.last_message_at,
          last_message_preview: c.last_message_preview,
          isMuted: !!(c as any).isMuted,
          mutedUntil: (c as any).mutedUntil ?? null,
        };
      });
      setContacts(mapped);
      pushToast({ type: 'success', msg: 'تم تحديث جهات الاتصال' });
    } catch {
      pushToast({ type: 'error', msg: 'تعذر تحديث جهات الاتصال' });
    }
  };

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [] as { key: string; index: number }[];
    const re = new RegExp(escapeRegExp(q), 'i');
    const matches: { key: string; index: number }[] = [];
    messages.forEach((m, idx) => {
      const content = (m.kind === 'transaction' && m.tx?.note) ? m.tx.note : m.text;
      if (content && re.test(content)) {
        const key = String(m.id ?? `i_${idx}`);
        matches.push({ key, index: idx });
      }
    });
    return matches;
  }, [messages, searchQuery]);
  
  useEffect(()=>{
    if(!isAuthed) return;
    (async()=>{
      try {
        const ws = await apiClient.getWallets();
        const next = { ...initialWallet } as any;
        if (Array.isArray(ws)) {
          for (const w of ws) {
            const code = w.currency?.code;
            if (code) {
              const val = parseFloat(w.balance);
              if (!isNaN(val)) next[code] = val;
            }
          }
        }
        setWallet(next);
      } catch (e:any) {
        pushToast({ type:'error', msg:'تعذر جلب المحافظ' });
      }
    })();
  }, [isAuthed]);

  // Load conversations and contacts once after authentication
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    (async () => {
      try {
        const convs = await apiClient.listConversations();
        if (!active) return;
        const convArr = Array.isArray(convs) ? convs : [];
        setConversations(convArr);
        const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
        for (const c of convArr) {
          if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
        }
        setConvMetaById(meta);
          const mapped = convArr.map((c: any) => {
          const meId = profile?.id;
          let other = c.user_a;
          if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
          return {
            id: c.id,
            otherUserId: other?.id,
            otherUsername: other?.username,
              name: other?.display_name || other?.username || other?.email || 'مستخدم',
              avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`,
            last_message_at: c.last_message_at,
            last_message_preview: c.last_message_preview,
            isMuted: !!(c as any).isMuted,
            mutedUntil: (c as any).mutedUntil ?? null,
          };
        });
        setContacts(mapped);
        // reset unread for any conversations not present anymore
        setUnreadByConv(prev => {
          const allowed = new Set(mapped.map(m=>m.id));
          const cp: Record<number, number> = {} as any;
          for (const id of Object.keys(prev)) {
            const n = Number(id);
            if (allowed.has(n)) cp[n] = prev[n];
          }
          return cp;
        });
      } catch {}
    })();
    return () => { active = false; };
  }, [isAuthed, profile?.id]);

  // Restore unread counters from localStorage once after auth
  useEffect(() => {
    if (!isAuthed || !profile?.id || unreadRestored) return;
    try {
      const key = `unread_by_conv_v1_${profile.id}`;
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const next: Record<number, number> = {} as any;
          for (const k of Object.keys(parsed)) {
            const n = Number(k);
            if (Number.isFinite(n)) next[n] = Number(parsed[k]) || 0;
          }
          setUnreadByConv(next);
        }
      }
    } catch {}
    setUnreadRestored(true);
  }, [isAuthed, profile?.id, unreadRestored]);

  // Persist unread counters to localStorage on change
  useEffect(() => {
    if (!isAuthed || !profile?.id) return;
    try {
      const key = `unread_by_conv_v1_${profile.id}`;
      if (typeof window !== 'undefined') localStorage.setItem(key, JSON.stringify(unreadByConv));
    } catch {}
  }, [unreadByConv, isAuthed, profile?.id]);

  // Restore last selected conversation from localStorage (per-user) or fallback to first
  useEffect(() => {
    if (!contacts || contacts.length === 0 || selectedConversationId != null) return;

    // On mobile, don't auto-open any conversation after refresh; keep user in the list view
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) {
      // Ensure we stay on the list; do not read savedId or fallback to first
      return;
    }
    let savedId: number | null = null;
    try {
      const key = `selected_conversation_id_${profile?.id ?? 'anon'}`;
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      if (raw) {
        const n = Number(raw);
        savedId = Number.isFinite(n) ? n : null;
      }
    } catch {}
    if (savedId && contacts.some(c => c.id === savedId)) {
      const idx = contacts.findIndex(c => c.id === savedId);
      setCurrentContactIndex(idx);
      setSelectedConversationId(savedId);
      setMobileView('chat');
    } else {
      // fallback to first contact
      setCurrentContactIndex(0);
      setSelectedConversationId(contacts[0].id);
    }
  }, [contacts, selectedConversationId, profile?.id]);

  // Keep selected index in sync if contacts reorder while a conversation is selected
  useEffect(() => {
    if (selectedConversationId == null || !contacts || contacts.length === 0) return;
    const idx = contacts.findIndex(c => c.id === selectedConversationId);
    if (idx !== -1 && idx !== currentContactIndex) {
      setCurrentContactIndex(idx);
    }
  }, [contacts, selectedConversationId]);

  // Persist selected conversation to localStorage (per-user key)
  useEffect(() => {
    if (selectedConversationId == null) return;
    try {
      const key = `selected_conversation_id_${profile?.id ?? 'anon'}`;
      if (typeof window !== 'undefined') localStorage.setItem(key, String(selectedConversationId));
    } catch {}
  }, [selectedConversationId, profile?.id]);

  // Live inbox: subscribe to per-user inbox WS for conversation list updates (no polling)
  useEffect(() => {
    if (!isAuthed) return;
    let closed = false;
    const sub = apiClient.connectInboxWithRetry();
    sub.on('open', () => { try { console.debug('[INBOX WS] open'); } catch {} });
    sub.on('message', (e: MessageEvent) => {
      // Debug inbox traffic
      try { const dbg = JSON.parse(e.data); if (dbg?.type) console.debug('[INBOX WS]', dbg.type, dbg); } catch {}
      if (closed) return;
      try {
        const data = JSON.parse(e.data);
        if (data?.type === 'inbox.update') {
          setContacts(prev => {
            const copy = prev ? [...prev] : [];
            const idx = copy.findIndex(c => c.id === data.conversation_id);
            if (idx !== -1) {
              // update preview/time and move to top like WhatsApp
              const updated = { ...copy[idx], last_message_preview: data.last_message_preview, last_message_at: data.last_message_at };
              copy.splice(idx, 1);
              copy.unshift(updated);
              return copy;
            }
            // If conversation not loaded yet, fetch full list once
            (async ()=>{
              try {
                const convs = await apiClient.listConversations();
                const mapped = convs.map((c: any) => {
                  const meId = profile?.id;
                  let other = c.user_a;
                  if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
                  return {
                    id: c.id,
                    otherUserId: other?.id,
                    otherUsername: other?.username,
                    name: other?.display_name || other?.username || other?.email || 'مستخدم',
                    avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`,
                    last_message_at: c.last_message_at,
                    last_message_preview: c.last_message_preview,
                    isMuted: !!(c as any).isMuted,
                    mutedUntil: (c as any).mutedUntil ?? null,
                  };
                });
                setConversations(convs);
                setContacts(mapped);
              } catch {}
            })();
            return copy;
          });
        }
      } catch {}
    });
    sub.on('close', (e: CloseEvent) => { try { console.debug('[INBOX WS] close', e.code, e.reason); } catch {} });
    sub.on('error', (e: Event) => { try { console.debug('[INBOX WS] error', e); } catch {} });
    const hb = setInterval(() => {
      const s: WebSocket | null = (sub as any).socket || null;
      if (s && s.readyState === WebSocket.OPEN) {
        try { s.send(JSON.stringify({ type: 'ping' })); } catch {}
      }
    }, 15000);
    return () => { closed = true; clearInterval(hb); sub.close(); };
  }, [isAuthed, profile?.id]);

  // Per-user Pusher notifications: update previews and unread counters and react to user profile updates
  useEffect(() => {
    if (!isAuthed || !profile?.id) return;
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY as string;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER as string;
    const pusher = new Pusher(key, { cluster });
    const channelName = `user_${profile.id}`;
    const channel = pusher.subscribe(channelName);
    let soundPromptShown = false;
    const onNotify = (data: any) => {
      try {
        if (data?.type === 'user.updated' && data?.user && data.user.id) {
          const upd = data.user;
          setContacts(prev => {
            const copy = prev ? [...prev] : [];
            for (let i = 0; i < copy.length; i++) {
              const c = copy[i];
              // We don't directly store other user id, so infer via username match if available
              if (c.otherUsername && c.otherUsername === upd.username) {
                copy[i] = {
                  ...c,
                  name: upd.display_name || upd.username || c.name,
                  avatar: c.avatar?.includes('ui-avatars.com')
                    ? `https://ui-avatars.com/api/?name=${encodeURIComponent((upd.display_name||upd.username||'U'))}&background=0D8ABC&color=fff`
                    : c.avatar,
                };
              }
            }
            return copy;
          });
          return; // handled
        }
        // default: treat as message notify
        const convId = Number(data?.conversation_id);
        if (!convId) return;
        setContacts(prev => {
          const copy = prev ? [...prev] : [];
          const idx = copy.findIndex(c => c.id === convId);
          if (idx !== -1) {
            copy[idx] = { ...copy[idx], last_message_preview: data?.preview || copy[idx].last_message_preview, last_message_at: data?.last_message_at || copy[idx].last_message_at };
          }
          return copy;
        });
        const isViewing = selectedConversationId === convId && mobileView === 'chat';
        if (!isViewing) {
          setUnreadByConv(prev => ({ ...prev, [convId]: (prev[convId] || 0) + 1 }));
          const from = data?.from ? String(data.from) : 'مستخدم';
          const preview = data?.preview ? String(data.preview) : '';
          pushToast({ type: 'info', msg: `رسالة جديدة من ${from}${preview ? `: ${preview}` : ''}` });
          const shouldSound = (typeof document !== 'undefined' && document.hidden) || !isViewing;
          if (shouldSound) {
            // Skip sound if this conversation is muted
            const muted = contacts.some(c => c.id === convId && c.isMuted);
            if (muted) return;
            tryPlayMessageSound().then(ok => {
              if (!ok && !soundPromptShown) { soundPromptShown = true; pushToast({ type: 'info', msg: 'انقر في الصفحة لتفعيل صوت الإشعارات' }); }
            }).catch(()=>{});
          }
        }
      } catch {}
    };
    channel.bind('notify', onNotify);
    return () => {
      try { channel.unbind('notify', onNotify); } catch {}
      try { pusher.unsubscribe(channelName); } catch {}
      try { pusher.disconnect(); } catch {}
    };
  }, [isAuthed, profile?.id, selectedConversationId, mobileView, contacts]);

  // استرجاع جلسة مخزنة بمجرد تحميل الصفحة
  useEffect(() => {
    // Prime audio playback via first user gesture
    attachPrimingListeners();
    // Load runtime sound URL from backend admin (if configured)
    (async () => {
      try {
        const url = await apiClient.getNotificationSoundUrl();
        if (url) setRuntimeSoundUrl(url);
      } catch {}
    })();
    // عند التحميل نحاول استرجاع الجلسة لمرة واحدة
    (async () => {
      if (authStatus !== 'checking') return;
      if (apiClient.access && apiClient.refresh) {
        try {
          const me = await apiClient.getProfile();
          setProfile(me);
          setIsAuthed(true);
          setAuthStatus('authed');
          return;
        } catch {
          // ignore fallthrough to guest
        }
      }
      setAuthStatus('guest');
    })();
  }, [authStatus]);

  // جلب العملات مرة واحدة بعد التوثيق
  useEffect(() => {
    if (!isAuthed) return;
    (async () => {
      try {
        let data: any[] = [];
        try {
          data = await apiClient.getCurrencies();
        } catch (e:any) {
          // فشل جلب أولي => إعادة محاولة بعد 600ms
          await new Promise(r=>setTimeout(r,600));
          try { data = await apiClient.getCurrencies(); } catch {}
        }
        if (!Array.isArray(data)) data = [];
        if (data.length === 0) {
          // محاولة bootstrap تلقائية إذا لم يكن لدينا بيانات
          try {
            const boot = await apiClient.bootstrapCurrencies();
            const again = await apiClient.getCurrencies().catch(()=>[]);
            setServerCurrencies(Array.isArray(again)? again : []);
            if (!again || (Array.isArray(again) && again.length === 0)) {
              pushToast({ type: 'error', msg: 'فشل تهيئة العملات – الخادم أعاد قائمة فارغة' });
            } else if (boot && Array.isArray(again) && again.length) {
              pushToast({ type: 'success', msg: 'تم إنشاء العملات الافتراضية' });
            }
          } catch (e:any) {
            pushToast({ type: 'error', msg: 'تعذر إنشاء العملات – تحقق من تسجيل الدخول أو الخادم' });
          }
        } else {
          setServerCurrencies(data);
        }
      } catch { /* تجاهل نهائي */ }
    })();
  }, [isAuthed]);

  // بعد التوثيق: ضمان وجود محادثة مع الأدمن للمستخدمين الجدد، وإظهار شريط الاشتراك عند المنع
  useEffect(() => {
    if (!isAuthed || !profile?.id) return;
    (async () => {
      try {
        const res = await apiClient.ensureAdminConversation();
        if (res && res.created) {
          try {
            const convs = await apiClient.listConversations();
            const convArr = Array.isArray(convs) ? convs : [];
            setConversations(convArr);
            const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
            for (const c of convArr) {
              if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
            }
            setConvMetaById(meta);
            const mapped = convArr.map((c: any) => {
              const meId = profile?.id;
              let other = c.user_a;
              if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
              return {
                id: c.id,
                otherUserId: other?.id,
                otherUsername: other?.username,
                name: other?.display_name || other?.username || other?.email || 'مستخدم',
                avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`,
                last_message_at: c.last_message_at,
                last_message_preview: c.last_message_preview,
                isMuted: !!(c as any).isMuted,
                mutedUntil: (c as any).mutedUntil ?? null,
              };
            });
            setContacts(mapped);
          } catch {}
        }
      } catch (e:any) {
        if (e && (e.status === 403 || e.status === 401)) {
          setSubBannerMsg(e.message || 'يرجى الاشتراك لتفعيل كامل الميزات');
          setShowSubBanner(true);
        }
      }
    })();
  }, [isAuthed, profile?.id]);

  // منطق إضافة المعاملة: إذا أدخل المستخدم قيمة في حقل "لنا" فهذا يعني أنه استلم (credit) وبالتالي زيادة في محفظته ونقصان عند الطرف الآخر
  // وإذا وضع في "لكم" يعني أنه دفع (debit) فتقل محفظته وتزداد محفظة الطرف الآخر.
  const addTransaction = async () => {
    if (!selectedConversationId) return;
    if (!amountOurs && !amountYours) return; // لا يوجد إدخال
    if (txLoading) return;
    setTxLoading(true);

    // تحقق من صحة المدخلات (أرقام موجبة فقط) + تقريب إلى 5 منازل
    const normalize = (raw:string) => {
      if (!raw) return NaN;
      const n = parseFloat(normalizeNumberString(raw));
      if (isNaN(n) || n <= 0) return NaN;
      return Number(n.toFixed(5));
    };
    const parsedOurs = normalize(amountOurs);
    const parsedYours = normalize(amountYours);
    const validOurs = !isNaN(parsedOurs) && parsedOurs > 0;
    const validYours = !isNaN(parsedYours) && parsedYours > 0;
    if (!validOurs && !validYours) {
      // كلاهما غير صالح
      setTxLoading(false);
      return;
    }

    // تجهيز العمليات (قد تكون عمليتين متتاليتين)
  const ops: { amount: number; direction: 'lna'|'lkm' }[] = [];
    if (validOurs) ops.push({ amount: parsedOurs, direction: 'lna' });
    if (validYours) ops.push({ amount: parsedYours, direction: 'lkm' });

    // أخذ نسخة للاحتفاظ بها في حالة التراجع (rollback)
    const prevWallet = { ...wallet };
    const prevCounter = { ...counterpartyWallet };
    let success = false;

    // إظهار مؤشر مؤقت (دون تعديل القيمة تفاؤلياً حتى لا تتضاعف)
    setPendingCurrencies(prev => new Set([...Array.from(prev), selectedCurrency]));

    // رسائل تفاؤلية لعرض بطاقة المعاملة مباشرة
    // ملاحظة: لم نعد نضيف رسائل تفاؤلية كفقاعات معاملة؛ نترك الرسائل كنصوص من الخادم كما كانت.

    try {
      let cid = currencyIdByCode(selectedCurrency);
      if (!cid) {
        // محاولة جلب العملات الآن
        try {
          const fresh = await apiClient.getCurrencies();
          setServerCurrencies(fresh);
          cid = fresh.find(c=>c.code===selectedCurrency)?.id;
        } catch {}
        // محاولة bootstrap وإنشاء العملات الافتراضية
        try {
          await apiClient.bootstrapCurrencies();
          const again = await apiClient.getCurrencies();
          setServerCurrencies(again);
          cid = again.find(c=>c.code===selectedCurrency)?.id;
        } catch {}
    }
    if (!cid) throw new Error('لا توجد عملات مهيأة بعد. جرّب إعادة تحميل الصفحة أو تسجيل الخروج والدخول أو تكرار العملية لاحقاً.');
      for (const op of ops) {
        await apiClient.createTransaction(
          selectedConversationId,
          cid,
          op.amount.toFixed(5),
          op.direction,
          noteText || undefined
        );
      }
      // تحديث الملخصات بعد نجاح فعلي (لتأكيد الأرقام من الخادم)
      const [s, n] = await Promise.all([
        apiClient.getSummary(selectedConversationId),
        apiClient.getNetBalance(selectedConversationId)
      ]);
      setSummary(s.summary || []);
      setNetBalance(n.net || []);
      // تأكد من توفر بيانات user_a/user_b لهذه المحادثة
      let metaForConv = convMetaById[selectedConversationId];
      if (!metaForConv) {
        try {
          const conv = await apiClient.getConversation(selectedConversationId);
          if (conv && conv.user_a && conv.user_b) {
            metaForConv = { user_a_id: conv.user_a.id, user_b_id: conv.user_b.id };
            setConvMetaById(prev => ({ ...prev, [selectedConversationId]: metaForConv! }));
          }
        } catch {}
      }
      // إعادة حساب المحفظة الزوجية من n.net (سجل المعاملات) من منظور المستخدم الحالي
      const pair: Record<string, number> = { ...initialWallet };
      const rows = Array.isArray(n?.net) ? n.net : [];
      const flip = (metaForConv && profile?.id)
        ? (profile.id === metaForConv.user_a_id ? 1 : -1)
        : 1;
      for (const row of rows) {
        const code = row?.currency?.code;
        const valRaw = row?.net_from_user_a_perspective;
        const val = typeof valRaw === 'number' ? valRaw : parseFloat(String(valRaw));
        if (code) pair[code] = isNaN(val) ? 0 : Number((flip * val).toFixed(5));
      }
      setPairWalletByConv(prev => ({ ...prev, [selectedConversationId]: pair }));
      // لم نعد نحدّث محفظة عامة للعرض
      success = true;
      pushToast({ type:'success', msg:'تم حفظ المعاملة' });
      // لا نقوم بإعادة جلب الرسائل هنا؛ نعتمد على إشعار الـ WS لإضافة الرسالة فوراً لتفادي الوميض
    } catch (e) {
      // فشل => التراجع عن التعديلات التفاؤلية
      // تراجُع على المحفظة الزوجية فقط
      if (selectedConversationId) {
        setPairWalletByConv(prev => ({ ...prev, [selectedConversationId]: { ...prev[selectedConversationId] } }));
      }
      const errMsg = (e as any)?.message || 'فشل حفظ المعاملة';
      pushToast({ type:'error', msg: errMsg });
  // لا شيء
    } finally {
      if (success) {
        setAmountOurs('');
        setAmountYours('');
        setNoteText('');
        setNoteModalOpen(false);
  // لا شيء
      }
      setPendingCurrencies(prev => { const cp = new Set(prev); cp.delete(selectedCurrency); return cp; });
      setTxLoading(false);
    }
  };

  const effectiveCurrencies = serverCurrencies.length ? serverCurrencies.map(c=>({ name: c.name || c.code, code: c.code, symbol: c.symbol })) : fallbackCurrencies;
  const symbolFor = (code:string) => effectiveCurrencies.find(c=>c.code===code)?.symbol || code;
  const formatMoneyValue = (num:number) => {
    if (isNaN(num)) return '0.00';
    const rounded = Number(num.toFixed(5));
    const parts = rounded.toString().split('.');
    if (parts.length === 1) return parts[0] + '.00';
    let frac = parts[1].replace(/0+$/,'');
    if (frac.length === 0) return parts[0] + '.00';
    if (frac.length === 1) return parts[0] + '.' + frac + '0';
    return parts[0] + '.' + frac;
  };
  const formatAmount = (v:number, code:string) => `${formatMoneyValue(v)} ${symbolFor(code)}`;

  // استقبال الرسائل عبر Pusher بدل WebSocket الداخلي
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY as string;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER as string;
    const channelName = `chat_${selectedConversationId}`;
    const pusher = new Pusher(key, { cluster });
    const channel = pusher.subscribe(channelName);
    let soundPromptShown = false;
    const onMessage = (data: any) => {
      try {
        if (data?.type === 'delete.request' && data?.conversation_id) {
          setPendingDeleteByConv(prev => ({ ...prev, [data.conversation_id]: { from: data.username || 'unknown', at: new Date().toISOString() } }));
          return;
        }
        if (data?.type === 'delete.approved' && data?.conversation_id) {
          // المحادثة حذفت بعد موافقة الطرف الآخر
          setPendingDeleteByConv(prev => { const cp = { ...prev }; delete cp[data.conversation_id]; return cp; });
          setContacts(prev => prev.filter(c => c.id !== data.conversation_id));
          if (selectedConversationId === data.conversation_id) {
            setSelectedConversationId(null);
            setCurrentContactIndex(null);
            setMessages([]);
            setSummary(null);
            setNetBalance(null);
          }
          pushToast({ type: 'success', msg: 'تم حذف جهة الاتصال بعد الموافقة' });
          return;
        }
        if (data?.type === 'delete.declined' && data?.conversation_id) {
          setPendingDeleteByConv(prev => { const cp = { ...prev }; delete cp[data.conversation_id]; return cp; });
          pushToast({ type: 'info', msg: 'رفض الطرف الآخر طلب الحذف' });
          return;
        }
        const isCurrent = !!(profile?.username && data?.username === profile.username);
        const txt = (data?.message ?? '').toString();
        const tx = parseTransaction(txt);
        if (isCurrent) {
          // Reconcile with optimistic 'sending' bubble instead of appending a duplicate
          setMessages(prev => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              const m = copy[i];
              if (m.sender === 'current' && m.status === 'sending' && m.text === txt) {
                copy[i] = { ...m, status: 'delivered', created_at: m.created_at || new Date().toISOString(), kind: tx ? 'transaction' : 'text', tx: tx || undefined } as any;
                return copy;
              }
            }
            // إذا لم نجد عنصر تفاؤلي، أضف واحدة (مثلاً عندما تأتي من جهاز آخر)
            return [
              ...prev,
              {
                sender: 'current',
                text: txt,
                created_at: new Date().toISOString(),
                kind: tx ? 'transaction' : 'text',
                tx: tx || undefined,
                status: 'delivered',
              } as any,
            ];
          });
        } else {
          // Receiver: append the incoming message
          setMessages(prev => ([
            ...prev,
            {
              sender: 'other',
              text: txt,
              created_at: new Date().toISOString(),
              kind: tx ? 'transaction' : 'text',
              tx: tx || undefined,
              status: 'delivered',
            } as any,
          ]));
          // Clear unread counter for this conversation if we are currently viewing it
          setUnreadByConv(prev => ({ ...prev, [selectedConversationId]: 0 }));
          // Play a soft sound if tab is hidden (we're in this conversation already)
          if (typeof document !== 'undefined' && document.hidden) {
            // Skip sound if current conversation is muted
            const muted = contacts.some(c => c.id === selectedConversationId && c.isMuted);
            if (muted) return;
            tryPlayMessageSound().then(ok => {
              if (!ok && !soundPromptShown) { soundPromptShown = true; pushToast({ type: 'info', msg: 'انقر في الصفحة لتفعيل صوت الإشعارات' }); }
            }).catch(()=>{});
          }
        }
      } catch {}
    };
    channel.bind('message', onMessage);
    return () => {
      try { channel.unbind('message', onMessage); } catch {}
      try { pusher.unsubscribe(channelName); } catch {}
      try { pusher.disconnect(); } catch {}
    };
  }, [isAuthed, selectedConversationId, profile?.username, contacts]);
  

  // Fetch messages when conversation changes (single fetch; no re-fetch on contact list reorder)
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    let active = true;
    // Reset state to prevent leaking messages from previous conversation
    setMessages([]);
    lastMessageIdRef.current = 0;
    setSummary(null);
    setNetBalance(null);
    (async () => {
      try {
        setLoadingMessages(true);
        const data = await apiClient.getMessages(selectedConversationId);
        if (!active) return;
        const mapped = (Array.isArray(data) ? data : []).map((m: any) => {
              const base: any = {
            id: m.id,
            sender: m.sender && profile && m.sender.id === profile.id ? 'current' : 'other',
            text: (m.body ?? '').toString(),
                created_at: m.created_at,
                attachment: (m.attachment_url || m.attachment_name) ? { url: m.attachment_url || null, name: m.attachment_name || undefined, mime: m.attachment_mime || undefined, size: typeof m.attachment_size === 'number' ? m.attachment_size : undefined } : undefined
          };
          if (m.type === 'transaction') {
            const tx = parseTransaction(base.text);
            if (tx) return { ...base, kind: 'transaction', tx };
          }
          return { ...base, kind: 'text' };
        });
        const chrono = mapped.reverse();
        setMessages(chrono);
        const last = chrono.length ? (chrono[chrono.length - 1].id || 0) : 0;
        lastMessageIdRef.current = typeof last === 'number' ? last : 0;
      } catch (e) {
        // silent for now
      } finally {
        setLoadingMessages(false);
      }
    })();
    return () => { active = false; };
  }, [isAuthed, selectedConversationId]);

  // التمرير التلقائي لأسفل عند تغير الرسائل
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // نستخدم requestAnimationFrame لضمان أن DOM حدث قبل التمرير
    requestAnimationFrame(()=>{
      el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  // Fetch summary & net balance
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    let active = true;
    (async () => {
      try {
        setLoadingSummary(true);
        const s = await apiClient.getSummary(selectedConversationId);
        const n = await apiClient.getNetBalance(selectedConversationId);
        if (!active) return;
        setSummary(s.summary || []);
        setNetBalance(n.net || []);
        // تأكد من توفر بيانات user_a/user_b لهذه المحادثة
        let metaForConv = convMetaById[selectedConversationId];
        if (!metaForConv) {
          try {
            const conv = await apiClient.getConversation(selectedConversationId);
            if (conv && conv.user_a && conv.user_b) {
              metaForConv = { user_a_id: conv.user_a.id, user_b_id: conv.user_b.id };
              setConvMetaById(prev => ({ ...prev, [selectedConversationId]: metaForConv! }));
            }
          } catch {}
        }
        // بناء المحفظة للعرض من net_balance (تجميعة سجل المعاملات) بمنظور المستخدم الحالي
        const pair: Record<string, number> = { ...initialWallet };
        const rows = Array.isArray(n?.net) ? n.net : [];
        const flip = (metaForConv && profile?.id)
          ? (profile.id === metaForConv.user_a_id ? 1 : -1)
          : 1;
        for (const row of rows) {
          const code = row?.currency?.code;
          const valRaw = row?.net_from_user_a_perspective;
          const val = typeof valRaw === 'number' ? valRaw : parseFloat(String(valRaw));
          if (code) pair[code] = isNaN(val) ? 0 : Number((flip * val).toFixed(5));
        }
        setPairWalletByConv(prev => ({ ...prev, [selectedConversationId]: pair }));
      } catch (e) {
        // ignore
      } finally {
        setLoadingSummary(false);
      }
    })();
    return () => { active = false; };
  }, [isAuthed, selectedConversationId, convMetaById, profile?.id]);

  // Open resilient WebSocket with retry
  useEffect(() => {
    if (!isAuthed || !selectedConversationId) return;
    const controller = apiClient.connectSocketWithRetry(selectedConversationId, { maxAttempts: 8 });
    controller.on('message', (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data);
        // Debug conversation traffic
        if (payload?.type) console.debug('[CHAT WS]', payload.type, {
          type: payload.type,
          conversation_id: payload.conversation_id,
          id: payload.id,
          client_id: payload.client_id,
          created_at: payload.created_at,
        });
        // Ignore payload.type === 'chat.message' since Pusher is the source of truth for messages now.
        if (payload.type === 'chat.typing') {
          // إظهار شريط يكتب الآن عندما الطرف الآخر يكتب
          const isMe = payload.user && profile && payload.user === profile.username;
          if (!isMe) {
            setIsOtherTyping(payload.state !== 'stop');
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (payload.state !== 'stop') {
              typingTimeoutRef.current = setTimeout(()=> setIsOtherTyping(false), 3000);
            }
          }
        }
        if (payload.type === 'chat.read') {
          const isMe = payload.reader && profile && payload.reader === profile.username;
          if (!isMe) {
            const lastId = Number(payload.last_read_id || 0);
            if (lastId > 0) {
              setMessages(prev => prev.map(m => (m.sender === 'current' && (m.id||0) <= lastId) ? { ...m, status: 'read' } : m));
            }
          }
        }
      } catch {}
    });
-    controller.on('open', () => { /* يمكن عرض حالة متصل */ });
-    controller.on('close', () => { /* يمكن لاحقاً تحديث UI */ });
+    controller.on('open', () => { setWs(controller.socket || null); });
+    controller.on('close', () => { setWs(null); });
+    setWs(controller.socket || null);
     return () => controller.close();
   }, [isAuthed, selectedConversationId, profile?.username]);

  // Zero-polling: لا يوجد استعلام دوري للرسائل؛ WS هو المصدر الوحيد بعد الجلب الأولي.

  const router = useRouter();
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setLoading(true);
      try {
        await apiClient.login(identifier, password);
      } catch (e:any) {
        if (e && e.otp_required) {
          const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز التحقق (OTP) من تطبيق المصادقة') : '';
          if (!code) throw e;
          await apiClient.login(identifier, password, code);
        } else {
          throw e;
        }
      }
      const me = await apiClient.getProfile().catch(()=>null);
      if(me) setProfile(me);
      setIsAuthed(true);
      setAuthStatus('authed');
      // Redirect-after-login
      try {
        const dest = sessionStorage.getItem('redirectAfterLogin') || '/';
        sessionStorage.removeItem('redirectAfterLogin');
        router.replace(dest);
      } catch {
        router.replace('/');
      }
    } catch (err:any) {
      setError(err?.message || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-chatBg text-gray-100 p-4">
        <div className="text-xs text-gray-400 animate-pulse">جاري التحميل...</div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-chatBg text-gray-100 p-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm bg-chatPanel border border-chatDivider rounded-lg p-6 flex flex-col gap-4">
          <h1 className="font-bold text-lg text-center">تسجيل الدخول</h1>
          {error && <div className="text-red-400 text-xs text-center">{error}</div>}
            <input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="اسم المستخدم أو البريد" className="bg-chatBg border border-chatDivider rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-600" />
            <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="كلمة المرور" type="password" className="bg-chatBg border border-chatDivider rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-600" />
            <button disabled={loading} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded py-2 font-semibold text-sm">{loading ? '...' : 'دخول'}</button>
            <p className="text-[10px] text-gray-400 text-center">استخدم حساباً موجوداً في Django Admin</p>
        </form>
      </div>
    );
  }

  return (
    <>
    <div className="w-full h-screen flex flex-col items-center p-0 md:p-4">{/* نستخدم h-screen لضبط الارتفاع الكامل */}
  <div className="w-full max-w-7xl flex flex-col border border-chatDivider rounded-lg overflow-hidden shadow-xl flex-1 min-h-0">{/* أزلنا height الثابت واستبدلناه بـ flex-1 */}
        <div className="flex flex-1 w-full h-full bg-chatBg isolate">
          {/* Sidebar (شاشات كبيرة فقط) */}
          <aside className="hidden md:flex w-80 md:w-96 bg-chatPanel border-l border-chatDivider flex-col relative z-20">
            <SidebarHeaderAddContact onAdded={async (newConv:any)=>{
              const convs = await apiClient.listConversations();
              const convArr = Array.isArray(convs) ? convs : [];
              setConversations(convArr);
              const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
              for (const c of convArr) {
                if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
              }
              setConvMetaById(meta);
              const mapped: {id:number; name:string; avatar:string; otherUsername?:string; last_message_at?: string; last_message_preview?: string; isMuted?: boolean; mutedUntil?: string|null}[] = convArr.map((c: any) => {
                const meId = profile?.id;
                let other = c.user_a;
                if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
                return { id: c.id, name: other?.display_name || other?.username || other?.email || 'مستخدم', avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`, otherUsername: other?.username, last_message_at: c.last_message_at, last_message_preview: c.last_message_preview, isMuted: !!(c as any).isMuted, mutedUntil: (c as any).mutedUntil ?? null };
              });
              setContacts(mapped);
              const idx = mapped.findIndex((m:{id:number})=>m.id===newConv.id);
              if(idx!==-1){ setCurrentContactIndex(idx); setSelectedConversationId(newConv.id); }
            }} existingUsernames={contacts.map(c=> c.otherUsername || c.name)} currentUsername={profile?.username} onRefreshContacts={refreshContacts} onSubscriptionGate={(reason)=>{ setSubBannerMsg(reason); setShowSubBanner(true); }} />
            <ul className="flex-1 overflow-y-auto divide-y divide-chatDivider/40 custom-scrollbar">
              {contacts.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-gray-400">
                  لا توجد محادثات بعد — اضغط على زر + لبدء محادثة جديدة
                </li>
              )}
              {contacts
                .slice()
                .sort((a,b)=>{
                  const ap = pinnedIds.includes(a.id) ? 1 : 0;
                  const bp = pinnedIds.includes(b.id) ? 1 : 0;
                  if (ap !== bp) return bp - ap; // pinned first
                  // then by last_message_at desc if available
                  const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                  const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                  return bt - at;
                })
                .map((contact, idx) => (
                <li
                  key={contact.id}
                  onClick={()=>{ const realIdx = contacts.findIndex(c=>c.id===contact.id); setCurrentContactIndex(realIdx); setSelectedConversationId(contact.id); setMobileView('chat'); setOpenMenuForConvId(null); setUnreadByConv(prev=>({ ...prev, [contact.id]: 0 })); }}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-chatDivider/30 transition ${contact.id === selectedConversationId ? 'bg-chatDivider/50' : ''}`}
                >
                  <img src={contact.avatar} alt={contact.name} className="w-10 h-10 rounded-full border border-chatDivider" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate flex items-center gap-1">{contact.name} {contact.isMuted && <span title="مكتمة">🔕</span>}</span>
                      <span className="text-[10px] text-gray-400" dir="ltr">{contact.last_message_at ? formatTimeShort(contact.last_message_at) : ''}</span>
                    </div>
                    <span className="text-xs text-gray-400 truncate">{contact.last_message_preview || ''}</span>
                  </div>
                  <div className="relative flex items-center gap-2" onClick={(e)=> e.stopPropagation()}>
                    {unreadByConv[contact.id] > 0 && (
                      <span className="bg-green-600 text-white rounded-full px-2 py-0.5 text-[10px] leading-none">{unreadByConv[contact.id]}</span>
                    )}
                    <button
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200"
                      title="تحرير"
                      onClick={()=> setOpenMenuForConvId(prev => prev===contact.id ? null : contact.id)}
                    >
                      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                        <path d='M12 20h9'/>
                        <path d='M16.5 3.5a2.121 2.121 0 013 3L7 19 3 20l1-4 12.5-12.5z'/>
                      </svg>
                    </button>
                    {openMenuForConvId === contact.id && (
                      <div className="absolute left-0 top-full mt-2 min-w-[180px] bg-chatBg border border-chatDivider rounded-lg shadow-xl overflow-hidden z-40">
                        <button
                          onClick={async ()=>{
                            setMuteBusyFor(contact.id);
                            setOpenMenuForConvId(null);
                            const prev = contacts;
                            setContacts(prev.map(c=> c.id===contact.id ? { ...c, isMuted: !c.isMuted } : c));
                            try {
                              if (contact.isMuted) await apiClient.unmuteConversation(contact.id); else await apiClient.muteConversation(contact.id);
                            } catch {
                              setContacts(prev);
                            } finally {
                              setMuteBusyFor(null);
                            }
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5 disabled:opacity-50"
                          disabled={muteBusyFor===contact.id}
                        >{contact.isMuted ? 'إلغاء الكتم' : 'كتم المحادثة'}</button>
                        <button
                          onClick={()=>{ setConfirmDialog({ open: true, kind: 'clear', convId: contact.id }); setOpenMenuForConvId(null); }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                        >مسح محتوى الدردشة</button>
                        <button
                          onClick={()=>{ setConfirmDialog({ open: true, kind: 'delete', convId: contact.id }); setOpenMenuForConvId(null); }}
                          className="w-full text-left px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                        >مسح جهة الاتصال</button>
                        <button
                          onClick={()=>{
                            setPinnedIds(prev => prev.includes(contact.id) ? prev.filter(id=>id!==contact.id) : [contact.id, ...prev]);
                            setOpenMenuForConvId(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                        >{pinnedIds.includes(contact.id) ? 'إلغاء التثبيت' : 'تثبيت في الأعلى'}</button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </aside>
          {/* Chat Window */}
          <main className="flex-1 flex flex-col h-full bg-chatBg min-h-0 relative z-0">{/* min-h-0 للسماح للـ overflow بالعمل */}
            {showSubBanner && (
              <div className="bg-amber-500/15 border-b border-amber-400/40 text-amber-200 px-4 py-2 text-xs flex items-center gap-2 flex-wrap md:flex-nowrap">
                <span className="flex-1 min-w-0 whitespace-normal break-words leading-5">{subBannerMsg || 'للوصول الكامل لميزات المنصة يرجى الاشتراك. يمكنك مراسلة الأدمن دون قيود.'}</span>
                <a href="/subscriptions" className="md:ml-auto ml-0 mt-1 md:mt-0 px-2 py-1 rounded bg-amber-500/30 hover:bg-amber-500/40 text-amber-50 border border-amber-400/40 shrink-0">اذهب لصفحة الاشتراك</a>
                <button onClick={()=> setShowSubBanner(false)} className="text-amber-200 hover:text-white shrink-0">✕</button>
              </div>
            )}
            {/* شريط تنبيه بالاشتراك عند وجود أخطاء منطقية من الخادم لاحقاً يمكن ربطه بحالة الملف الشخصي */}
            {/* مبدئياً سنعرض تلميح الانتقال لقسم الاشتراك في حال ظهرت رسائل منع من الخادم عبر التوستات أعلاه */}
            {/* قائمة الدردشات نسخة للجوال */}
            {mobileView === 'list' && (
              <div className="flex flex-col md:hidden h-full">
                <div className="border-b border-chatDivider bg-chatPanel">
                  <SidebarHeaderAddContact onAdded={async (newConv:any)=>{
                    const convs = await apiClient.listConversations();
                    const convArr = Array.isArray(convs) ? convs : [];
                    setConversations(convArr);
                    const meta: Record<number, { user_a_id:number; user_b_id:number }> = {};
                    for (const c of convArr) {
                      if (c && c.id && c.user_a && c.user_b) meta[c.id] = { user_a_id: c.user_a.id, user_b_id: c.user_b.id };
                    }
                    setConvMetaById(meta);
                    const mapped: {id:number; name:string; avatar:string; otherUsername?:string; last_message_at?: string; last_message_preview?: string; isMuted?: boolean; mutedUntil?: string|null}[] = convArr.map((c: any) => {
                      const meId = profile?.id;
                      let other = c.user_a;
                      if (meId && c.user_a && c.user_a.id === meId) other = c.user_b; else if (meId && c.user_b && c.user_b.id === meId) other = c.user_a; else if (c.user_b) other = c.user_b;
                      return { id: c.id, name: other?.display_name || other?.username || other?.email || 'مستخدم', avatar: other?.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((other?.display_name||other?.username||'U'))}&background=0D8ABC&color=fff`, otherUsername: other?.username, last_message_at: c.last_message_at, last_message_preview: c.last_message_preview, isMuted: !!(c as any).isMuted, mutedUntil: (c as any).mutedUntil ?? null };
                    });
                    setContacts(mapped);
                    const idx = mapped.findIndex((m:{id:number})=>m.id===newConv.id);
                    if(idx!==-1){ setCurrentContactIndex(idx); setSelectedConversationId(newConv.id); setMobileView('chat'); }
                  }} existingUsernames={contacts.map(c=> c.otherUsername || c.name)} currentUsername={profile?.username} onRefreshContacts={refreshContacts} onSubscriptionGate={(reason)=>{ setSubBannerMsg(reason); setShowSubBanner(true); }} />
                </div>
                <ul className="flex-1 overflow-y-auto divide-y divide-chatDivider/40 custom-scrollbar">
                  {contacts
                    .slice()
                    .sort((a,b)=>{
                      const ap = pinnedIds.includes(a.id) ? 1 : 0;
                      const bp = pinnedIds.includes(b.id) ? 1 : 0;
                      if (ap !== bp) return bp - ap;
                      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
                      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
                      return bt - at;
                    })
                    .map((contact, idx) => (
                    <li
                      key={contact.id}
                      onClick={()=>{ const realIdx = contacts.findIndex(c=>c.id===contact.id); setCurrentContactIndex(realIdx); setSelectedConversationId(contact.id); setMobileView('chat'); setOpenMenuForConvId(null); setUnreadByConv(prev=>({ ...prev, [contact.id]: 0 })); }}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-chatDivider/30 transition ${contact.id === selectedConversationId ? 'bg-chatDivider/50' : ''}`}
                    >
                      <img src={contact.avatar} alt={contact.name} className="w-10 h-10 rounded-full border border-chatDivider" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate flex items-center gap-1">{contact.name} {contact.isMuted && <span title="مكتمة">🔕</span>}</span>
                          <span className="text-[10px] text-gray-400" dir="ltr">{contact.last_message_at ? formatTimeShort(contact.last_message_at) : ''}</span>
                        </div>
                        <span className="text-xs text-gray-400 truncate">{contact.last_message_preview || ''}</span>
                      </div>
                      <div className="relative flex items-center gap-2" onClick={(e)=> e.stopPropagation()}>
                        {unreadByConv[contact.id] > 0 && (
                          <span className="bg-green-600 text-white rounded-full px-2 py-0.5 text-[10px] leading-none">{unreadByConv[contact.id]}</span>
                        )}
                        <button
                          className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200"
                          title="تحرير"
                          onClick={()=> setOpenMenuForConvId(prev => prev===contact.id ? null : contact.id)}
                        >
                          <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                            <path d='M12 20h9'/>
                            <path d='M16.5 3.5a2.121 2.121 0 013 3L7 19 3 20l1-4 12.5-12.5z'/>
                          </svg>
                        </button>
                        {openMenuForConvId === contact.id && (
                          <div className="absolute left-0 top-full mt-2 min-w-[180px] bg-chatBg border border-chatDivider rounded-lg shadow-xl overflow-hidden z-40">
                            <button
                              onClick={async ()=>{
                                setMuteBusyFor(contact.id);
                                setOpenMenuForConvId(null);
                                const prev = contacts;
                                setContacts(prev.map(c=> c.id===contact.id ? { ...c, isMuted: !c.isMuted } : c));
                                try {
                                  if (contact.isMuted) await apiClient.unmuteConversation(contact.id); else await apiClient.muteConversation(contact.id);
                                } catch {
                                  setContacts(prev);
                                } finally {
                                  setMuteBusyFor(null);
                                }
                              }}
                              className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5 disabled:opacity-50"
                              disabled={muteBusyFor===contact.id}
                            >{contact.isMuted ? 'إلغاء الكتم' : 'كتم المحادثة'}</button>
                            <button
                              onClick={()=>{ setConfirmDialog({ open: true, kind: 'clear', convId: contact.id }); setOpenMenuForConvId(null); }}
                              className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                            >مسح محتوى الدردشة</button>
                            <button
                              onClick={()=>{ setConfirmDialog({ open: true, kind: 'delete', convId: contact.id }); setOpenMenuForConvId(null); }}
                              className="w-full text-left px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                            >مسح جهة الاتصال</button>
                            <button
                              onClick={()=>{
                                setPinnedIds(prev => prev.includes(contact.id) ? prev.filter(id=>id!==contact.id) : [contact.id, ...prev]);
                                setOpenMenuForConvId(null);
                              }}
                              className="w-full text-left px-3 py-2 text-xs text-gray-100 hover:bg-white/5"
                            >{pinnedIds.includes(contact.id) ? 'إلغاء التثبيت' : 'تثبيت في الأعلى'}</button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* واجهة المحادثة */}
            {(selectedConversationId != null && currentContact) && (
              <div className={(mobileView === 'chat' ? 'flex' : 'hidden') + ' md:flex flex-col h-full'}>
                        <div className="bg-chatPanel px-6 py-3 font-bold border-b border-chatDivider text-sm flex items-center gap-6 flex-wrap">
              {/* شريط أرصدة سريع من منظور هذه المحادثة فقط (موجب = لنا، سالب = لكم) — مخفي عند الدردشة مع admin أو عند كون المستخدم الحالي أدمن */}
              {((profile?.username?.toLowerCase() !== 'admin') && (currentContact?.otherUsername?.toLowerCase() !== 'admin')) && (
                <div className="flex gap-4 text-xs md:text-sm order-2 md:order-1 w-full md:w-auto justify-between md:justify-start">
                  {currencyCodes().map(code => {
                    const pair = getPairWallet(selectedConversationId);
                    const val = (pair as any)[code] ?? 0;
                    const positive = val >= 0;
                    const isPending = pendingCurrencies.has(code);
                    return (
                      <span key={code} className={(positive ? 'text-green-400' : 'text-red-400') + ' font-semibold flex items-center gap-1'}>
                        <span dir="ltr" className="inline-block tabular-nums">
                          {formatAmount(val, code)}
                        </span>
                        {isPending && <span className="text-yellow-400 animate-pulse" title="قيمة مؤقتة قيد التأكيد">⚡</span>}
                      </span>
                    );
                  })}
                </div>
              )}
              {/* زر رجوع للجوال */}
              <button onClick={()=>setMobileView('list')} className="md:hidden text-gray-300 hover:text-white" title="رجوع"><svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/></svg></button>
              <img src={currentContact.avatar} alt={currentContact.name} className="w-9 h-9 rounded-full border border-chatDivider" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold flex items-center gap-1">{currentContact.name} {currentContact.isMuted && <span title="مكتمة">🔕</span>}</span>
              </div>
              <div className="ml-auto flex items-center gap-3 text-gray-300">
                <button onClick={()=>{ setSearchOpen(s=>!s); if (!searchOpen) setTimeout(()=>{ const el = document.getElementById('inchat_search_input'); el && (el as HTMLInputElement).focus(); }, 50); }} className="hover:text-white transition" title="بحث">
                  <svg xmlns='http://www.w3.org/2000/svg' className='h-4 w-4' viewBox='0 0 20 20' fill='currentColor'><path fillRule='evenodd' d='M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z' clipRule='evenodd'/></svg>
                </button>
                <button className="hover:text-white transition" title="معلومات"><svg xmlns='http://www.w3.org/2000/svg' className='h-4 w-4' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z'/></svg></button>
              </div>
            </div>
            {/* إشعار طلب حذف المحادثة وجهة الاتصال */}
            {selectedConversationId && pendingDeleteByConv[selectedConversationId] && (
              <div className="bg-yellow-500/10 border-y border-yellow-400/40 text-yellow-200 px-6 py-2 text-xs flex items-center gap-3">
                <span className="font-semibold">هناك طلب حذف لهذه المحادثة وجهة الاتصال.</span>
                <span className="px-2 py-0.5 rounded bg-yellow-300 text-yellow-900 font-bold">سيتم حذف المطابقة المالية بين الطرفين</span>
                <span className="ml-auto"></span>
                {(profile?.username && pendingDeleteByConv[selectedConversationId].from !== profile.username) ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async()=>{
                        try { await apiClient.approveDeleteConversation(selectedConversationId!); }
                        catch(e:any){ pushToast({type:'error', msg: e?.message||'تعذر الموافقة'}); }
                      }}
                      className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
                    >موافقة على الحذف</button>
                    <button
                      onClick={async()=>{
                        try { await apiClient.declineDeleteConversation(selectedConversationId!); setPendingDeleteByConv(prev=>{ const cp:any={...prev}; delete cp[selectedConversationId!]; return cp; }); pushToast({type:'info', msg:'تم رفض طلب الحذف'}); }
                        catch(e:any){ pushToast({type:'error', msg: e?.message||'تعذر الرفض'}); }
                      }}
                      className="px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white"
                    >رفض</button>
                  </div>
                ) : (
                  <span className="text-[11px]">تم إرسال الطلب — بانتظار موافقة الطرف الآخر</span>
                )}
              </div>
            )}
            {searchOpen && (
              <div className="bg-chatPanel/90 border-b border-chatDivider px-4 py-2 flex items-center gap-2">
                <input
                  id="inchat_search_input"
                  value={searchQuery}
                  onChange={(e)=>{ setSearchQuery(e.target.value); setActiveMatchIdx(0); }}
                  placeholder="ابحث داخل هذه الدردشة"
                  className="flex-1 bg-chatBg border border-chatDivider rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-600 text-gray-100"
                />
                <span className="text-[10px] text-gray-400 min-w-[4rem] text-center">
                  {searchQuery.trim() ? (searchMatches.length ? `${(activeMatchIdx+1)}/${searchMatches.length}` : 'لا نتائج') : ''}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={()=> setActiveMatchIdx(i=> (i-1+Math.max(1,searchMatches.length)) % Math.max(1,searchMatches.length))}
                    disabled={!searchMatches.length}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 backdrop-blur-sm"
                    title="السابق"
                  >
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-3.5 w-3.5' viewBox='0 0 20 20' fill='currentColor'><path d='M12.293 16.293a1 1 0 010 1.414l-1.414 1.414a1 1 0 01-1.414 0L2.586 12l6.879-6.879a1 1 0 011.414 0l1.414 1.414a1 1 0 010 1.414L7.414 12l4.879 4.879z'/></svg>
                  </button>
                  <button
                    onClick={()=> setActiveMatchIdx(i=> (i+1) % Math.max(1,searchMatches.length))}
                    disabled={!searchMatches.length}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 backdrop-blur-sm"
                    title="التالي"
                  >
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-3.5 w-3.5' viewBox='0 0 20 20' fill='currentColor'><path d='M7.707 3.707a1 1 0 010-1.414L9.121.879a1 1 0 011.414 0L17.414 7l-6.879 6.879a1 1 0 01-1.414 0l-1.414-1.414a1 1 0 010-1.414L12.586 7 7.707 3.707z'/></svg>
                  </button>
                  <button onClick={()=>{ setSearchOpen(false); setSearchQuery(''); }} className="w-7 h-7 flex items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300" title="إغلاق">✕</button>
                </div>
              </div>
            )}
            <div ref={scrollRef} className="flex-1 p-6 pb-40 flex flex-col gap-2 overflow-y-auto bg-[#0f1f25] custom-scrollbar" dir="rtl" id="chatScrollRegion">{/* pb-40 لترك مساحة أسفل للأشرطة المثبتة */}
              {(function(){
                const parts: React.ReactNode[] = [];
                let lastDayKey = '';
                messages.forEach((m, i) => {
                  const dk = dayKeyOf(m.created_at);
                  if (dk !== lastDayKey && dk !== 'unknown') {
                    parts.push(
                      <div key={`sep_${dk}`} className="mx-auto my-3 text-[10px] px-3 py-1 bg-gray-700/60 border border-chatDivider rounded-full text-gray-200">
                        {dayLabelOf(m.created_at)}
                      </div>
                    );
                    lastDayKey = dk;
                  }
                  if (m.kind === 'transaction' && m.tx) {
                    const key = String(m.id ?? `tx_${i}`);
                    parts.push(
                      <div key={key} ref={(el)=>{ messageRefs.current[key] = el; }} className={m.sender === 'current' ? 'self-start' : 'self-end'}>
                        <TransactionBubble sender={m.sender} tx={m.tx} createdAt={m.created_at} />
                        {searchQuery && m.tx.note && (
                          <div className="sr-only">{m.tx.note}</div>
                        )}
                      </div>
                    );
                  } else {
                    const key = String(m.id ?? (m.client_id ? `c_${m.client_id}` : `i_${i}`));
                    const content = m.text;
                    const showHighlight = !!searchQuery.trim();
                    parts.push(
                      <div
                        key={key}
                        ref={(el)=>{ messageRefs.current[key] = el; }}
                        className={
                          m.sender === 'current'
                            ? 'self-start bg-bubbleReceived text-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm max-w-[60%] text-xs shadow whitespace-pre-line'
                            : 'self-end bg-bubbleSent text-white px-3 py-2 rounded-2xl rounded-br-sm max-w-[60%] text-xs shadow whitespace-pre-line'
                        }
                      >
                        {/* Attachment preview if present */}
                        {m.attachment && (m.attachment.url || m.attachment.name) && (
                          <div className="mb-1">
                            {m.attachment.mime && m.attachment.mime.startsWith('image/') && m.attachment.url ? (
                              <img
                                src={m.attachment.url}
                                alt={m.attachment.name || 'image'}
                                className="max-w-[240px] rounded border border-white/10 cursor-zoom-in hover:opacity-90 transition"
                                onClick={(e)=>{ e.stopPropagation(); openImageAt(m.attachment!.url!); }}
                              />
                            ) : (
                              <a href={m.attachment.url || '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-300 hover:text-blue-200 underline">
                                <svg xmlns='http://www.w3.org/2000/svg' className='h-4 w-4' viewBox='0 0 24 24' fill='currentColor'><path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/><path d='M14 2v6h6'/></svg>
                                <span className="truncate max-w-[200px]">{m.attachment.name || 'مرفق'}</span>
                              </a>
                            )}
                          </div>
                        )}
                        {(content || '').trim() ? (showHighlight ? highlightText(content, searchQuery) : content) : null}
                        <div className="mt-1 text-[10px] text-gray-400 flex items-center gap-1 justify-end" dir="ltr">
                          <span>{formatTimeShort(m.created_at)}</span>
                          {m.sender === 'current' && (
                            <span>{m.status === 'sending' ? '…' : m.status === 'read' ? '✓✓' : '✓'}</span>
                          )}
                        </div>
                      </div>
                    );
                  }
                });
                return parts;
              })()}
              {/* فاصل غير مقروءة بسيط: في هذه النسخة المبدئية لم نحدد بدقة مكانه */}
              {unreadDividerId && (
                <div className="my-2 text-center text-[10px] text-gray-400">رسائل غير مقروءة</div>
              )}
            </div>
            {/* شريط سفلي موحد (معاملات + رسالة) */}
            <div className="border-t border-chatDivider bg-chatPanel sticky bottom-0 z-10 flex flex-col gap-2 p-3">
              {((profile?.username?.toLowerCase() !== 'admin') && (currentContact?.otherUsername?.toLowerCase() !== 'admin')) && (
                <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
                  <button onClick={()=>setTxPanelCollapsed(c=>!c)} className="bg-gray-700 hover:bg-gray-600 text-white rounded px-2 py-1" title={txPanelCollapsed? 'إظهار المعاملات':'إخفاء المعاملات'}>
                    {txPanelCollapsed? '▼' : '▲'}
                  </button>
                  {!txPanelCollapsed && (
                    <>
                    <select value={selectedCurrency} onChange={e=>setSelectedCurrency(e.target.value)} className="bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 focus:outline-none w-auto min-w-0">
                      {effectiveCurrencies.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                    <input value={amountOurs} onChange={e=>setAmountOurs(e.target.value)} inputMode="decimal" placeholder="لنا" className="w-24 bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 focus:outline-none" />
                    <input value={amountYours} onChange={e=>setAmountYours(e.target.value)} inputMode="decimal" placeholder="لكم" className="w-24 bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 focus:outline-none" />
                    <button
                      onClick={()=>setNoteModalOpen(true)}
                      className="relative group w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 text-gray-200 transition"
                      title="إضافة ملاحظة"
                    >
                      <svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.6} d='M11 5H6a2 2 0 00-2 2v9.5A1.5 1.5 0 005.5 18H15a2 2 0 002-2v-1M16 3l5 5M16 3v4a1 1 0 001 1h4' />
                      </svg>
                    </button>
                    <button
                      onClick={addTransaction}
                      disabled={txLoading}
                      className="relative group w-9 h-9 flex items-center justify-center rounded-lg bg-green-500/20 hover:bg-green-500/30 disabled:opacity-50 backdrop-blur-sm border border-green-400/30 text-green-300 transition"
                      title="حفظ المعاملة"
                    >
                      {txLoading ? (
                        <svg className='animate-spin h-5 w-5 text-green-300' viewBox='0 0 24 24'>
                          <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='3'></circle>
                          <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z'></path>
                        </svg>
                      ) : (
                        <svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                          <path d='M12 4v16m8-8H4' />
                        </svg>
                      )}
                    </button>
                    </>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                {/* معاينة مرفق قيد الانتظار */}
                {pendingAttachment && (
                  <div className="flex items-center gap-2 text-xs text-gray-200 bg-white/5 border border-white/10 rounded px-2 py-1 max-w-[50%]">
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-4 w-4' viewBox='0 0 24 24' fill='currentColor'><path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/><path d='M14 2v6h6'/></svg>
                    <span className="truncate">{pendingAttachment.name}</span>
                    <button onClick={()=> setPendingAttachment(null)} className="ml-1 text-gray-400 hover:text-white" title="إزالة">×</button>
                  </div>
                )}
                <input type="file" id="chat_file_input" className="hidden" accept="image/*,application/pdf" onChange={async (e)=>{
                  try {
                    const f = e.target.files && e.target.files[0];
                    if (!f) return;
                    // تحقق محلي يطابق حدود الخادم
                    const isPdf = f.type === 'application/pdf';
                    const max = isPdf ? 10*1024*1024 : 5*1024*1024;
                    if (f.size > max) { pushToast({ type: 'error', msg: isPdf ? 'حجم PDF يتجاوز 10MB' : 'حجم الصورة يتجاوز 5MB' }); (e.target as HTMLInputElement).value = ''; return; }
                    setPendingAttachment(f);
                    // نظّف قيمة المدخل للسماح باختيار نفس الملف لاحقاً
                    (e.target as HTMLInputElement).value = '';
                  } catch {}
                }} />
                <button className="text-gray-400 hover:text-white" title="إرفاق" onClick={()=>{ const el = document.getElementById('chat_file_input') as HTMLInputElement|null; el?.click(); }}><svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828a4 4 0 10-5.656-5.656L6.343 10.172'/></svg></button>
                <textarea
                  ref={textAreaRef}
                  rows={1}
                  value={outgoingText}
                  onChange={(e)=>{ onChangeOutgoing(e.target.value); try{ if(textAreaRef.current){ textAreaRef.current.style.height='auto'; textAreaRef.current.style.height = Math.min(160, textAreaRef.current.scrollHeight) + 'px'; } }catch{} }}
                  onKeyDown={(e)=>{
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                      setTimeout(()=>{ try{ ws && ws.readyState===WebSocket.OPEN && ws.send(JSON.stringify({ type:'typing', state:'stop'})); }catch{} }, 100);
                    }
                  }}
                  placeholder="اكتب رسالة"
                  className="flex-1 border border-chatDivider bg-chatBg text-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-600 resize-none overflow-y-auto min-h-[40px] max-h-40"
                />
                  <button
                   onClick={sendChat}
                   className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center text-gray-200 transition"
                   title="إرسال الرسالة"
                 >
                   <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' className='h-5 w-5' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
                     <path d='M5 15l7-7 7 7'/>
                   </svg>
                 </button>
               </div>
               {isOtherTyping && (
                 <div className="px-2 pt-1 text-[10px] text-gray-300">يكتب الآن…</div>
               )}
            </div>
            {/* إغلاق الغلاف الخاص بواجهة المحادثة */}
            </div>
            )}
            {mobileView === 'chat' && (selectedConversationId == null || !currentContact) && (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
                اختر محادثة من القائمة أو ابدأ محادثة جديدة من زر +
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
    {/* Toasts */}
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 rtl:right-auto rtl:left-4">
      {toasts.map(t => (
        <div key={t.id} className={"px-4 py-2 rounded shadow text-xs font-semibold border " + (t.type==='success' ? 'bg-green-600/90 border-green-400 text-white' : t.type==='error' ? 'bg-red-600/90 border-red-400 text-white' : 'bg-gray-600/90 border-gray-400 text-white') }>
          {t.msg}
        </div>
      ))}
    </div>
    {/* Lightbox Overlay */}
    {lightboxOpen && (() => {
      const items = buildImageItems();
      const item = items[lightboxIndex];
      if (!item) return null;
      return (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col" onClick={()=> setLightboxOpen(false)}>
          <div className="flex items-center justify-between p-3 text-white text-sm">
            <span className="opacity-80 truncate pr-2">{item.name || 'صورة'}</span>
            <div className="flex items-center gap-2">
              <a href={item.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">فتح في تبويب</a>
              <button onClick={(e)=>{ e.stopPropagation(); setLightboxOpen(false); }} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">إغلاق ✕</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-2" onClick={(e)=> e.stopPropagation()}>
            <img src={item.url} alt={item.name || 'image'} className="max-h-[85vh] max-w-[95vw] object-contain" />
          </div>
          {items.length > 1 && (
            <>
              <button
                onClick={(e)=>{ e.stopPropagation(); setLightboxIndex(i=> Math.max(0, i-1)); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                title="السابق"
              >
                ‹
              </button>
              <button
                onClick={(e)=>{ e.stopPropagation(); setLightboxIndex(i=> Math.min(items.length-1, i+1)); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                title="التالي"
              >
                ›
              </button>
            </>
          )}
        </div>
      );
    })()}
    {noteModalOpen && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-chatPanel border border-chatDivider rounded-lg w-full max-w-md p-4 flex flex-col gap-3">
          <h3 className="font-bold text-gray-100 text-sm">إضافة ملاحظة</h3>
          <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} rows={4} className="w-full resize-none bg-chatBg border border-chatDivider rounded p-2 text-gray-100 text-xs focus:outline-none focus:ring-1 focus:ring-green-600" placeholder="اكتب ملاحظتك هنا"></textarea>
          <div className="flex justify-end gap-2 text-xs">
            <button onClick={()=>{setNoteText(''); setNoteModalOpen(false);}} className="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white">إلغاء</button>
            <button onClick={()=>{setNoteModalOpen(false);}} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">حفظ مؤقتاً</button>
          </div>
        </div>
      </div>
    )}
    {confirmDialog?.open && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-chatPanel border border-chatDivider rounded-lg w-full max-w-sm p-4 flex flex-col gap-3">
          <h3 className="font-bold text-gray-100 text-sm">
            {confirmDialog.kind === 'delete' ? 'تأكيد حذف جهة الاتصال' : 'تأكيد مسح محتوى الدردشة'}
          </h3>
          <div className="text-[12px] text-gray-200 leading-6">
            {confirmDialog.kind === 'delete'
              ? 'سيتم حذف جهة الاتصال والمحادثة المرتبطة بها من قائمتك بعد موافقة الطرف الآخر. لن تتمكن من استعادة الرسائل المحذوفة. سيتم إرسال طلب حذف إلى الطرف الآخر. هل أنت متأكد؟'
              : 'سيتم مسح جميع رسائل هذه المحادثة من جهازك وقاعدة البيانات ولن يمكن استعادتها. هل أنت متأكد؟'}
            {confirmDialog.kind === 'delete' && (
              <div className="mt-2">
                <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-800 text-[12px] font-bold">سيتم حذف المطابقة المالية بين الطرفين</span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 text-xs mt-1">
            <button onClick={()=> setConfirmDialog(null)} className="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white">إلغاء</button>
            <button
              onClick={async()=>{
                const id = confirmDialog!.convId;
                const kind = confirmDialog!.kind;
                if (kind === 'clear') {
                  try {
                    await apiClient.clearConversation(id);
                    if (selectedConversationId === id) {
                      setMessages([]);
                      setSummary(null);
                      setNetBalance(null);
                    }
                    setContacts(prev => prev.map(c => c.id===id ? { ...c, last_message_preview: '', last_message_at: null } : c));
                    pushToast({type:'success', msg:'تم مسح محتوى الدردشة'});
                  } catch(e:any) {
                    pushToast({type:'error', msg: e?.message||'فشل المسح'});
                  } finally {
                    setConfirmDialog(null);
                  }
                } else if (kind === 'delete') {
                  try {
                    try {
                      await apiClient.requestDeleteConversation(id);
                    } catch (err:any) {
                      if (err && err.otp_required) {
                        const code = typeof window !== 'undefined' ? window.prompt('أدخل رمز التحقق (OTP) لتأكيد طلب الحذف') : '';
                        if (!code) throw err;
                        await apiClient.requestDeleteConversation(id, code);
                      } else {
                        throw err;
                      }
                    }
                    setPendingDeleteByConv(prev=> ({ ...prev, [id]: { from: profile?.username || 'me', at: new Date().toISOString() } }));
                    pushToast({type:'info', msg:'تم إرسال طلب الحذف وينتظر الموافقة'});
                  } catch(e:any) {
                    pushToast({type:'error', msg: e?.message||'تعذر إرسال طلب الحذف'});
                  } finally {
                    setConfirmDialog(null);
                  }
                }
              }}
              className={"px-3 py-1 rounded text-white " + (confirmDialog.kind==='delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700')}
            >
              {confirmDialog.kind === 'delete' ? 'إرسال طلب الحذف' : 'مسح نهائي'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
