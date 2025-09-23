"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { attachPrimingListeners, tryPlayMessageSound } from '@/lib/sound';
import { DEBUG_FORCE_APPEND } from '@/lib/config';

type Msg = { id:number; conversation:number; sender:any; type:'text'|'system'|'transaction'; body:string; created_at:string };

// Simple ticks like WhatsApp: single (not delivered), double gray (delivered), double blue (read)
function Ticks({ state }: { state: 'single'|'double'|'blue' }) {
  const base = 'inline-block align-middle';
  if (state === 'single') {
    return (
      <svg className={base} width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 6L9 17l-5-5" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (state === 'blue') {
    return (
      <svg className={base} width="20" height="18" viewBox="0 0 28 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M26 6L15 17l-5-5" stroke="#34B7F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 6L11 17l-5-5" stroke="#34B7F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  return (
    <svg className={base} width="20" height="18" viewBox="0 0 28 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M26 6L15 17l-5-5" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22 6L11 17l-5-5" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const convId = useMemo(()=> Number(params?.id), [params]);
  const [conv, setConv] = useState<any|null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const listRef = useRef<HTMLDivElement|null>(null);
  const lastIdRef = useRef<number>(0);
  const wsRef = useRef<WebSocket|null>(null);
  const [lastReadByOther, setLastReadByOther] = useState<number>(0);

  // Centered alerts for member add/remove
  type CenterAlert = { id: string; type: 'added'|'removed'|'info'; msg: string };
  const [centerAlerts, setCenterAlerts] = useState<CenterAlert[]>([]);
  const pushCenterAlert = (t: { type: 'added'|'removed'|'info'; msg: string }, ttlMs: number = 3000) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setCenterAlerts(prev => [...prev, { id, ...t }]);
    setTimeout(() => setCenterAlerts(prev => prev.filter(x => x.id !== id)), ttlMs);
  };
  const detectMemberChange = (text: string): { action: 'added'|'removed'; name?: string } | null => {
    try {
      const t = (text || '').trim();
      const rem = t.match(/إزالة\s+([^\s]+)\s+من\s+المحادثة/);
      if (rem) return { action: 'removed', name: rem[1] };
      const add1 = t.match(/إضافة\s+([^\s]+)\s+عضو\s+الفريق/);
      if (add1) return { action: 'added', name: add1[1] };
      const addAlt = t.match(/إضافة\s+عضو\s+الفريق\s+([^\s]+)/);
      if (addAlt) return { action: 'added', name: addAlt[1] };
      const add2 = t.match(/إضافة\s+([^\s]+)\s+إلى\s+المحادثة/);
      if (add2) return { action: 'added', name: add2[1] };
    } catch {}
    return null;
  };

  // Redirect-to-login guard
  useEffect(() => {
    const hasTokens = typeof window !== 'undefined' && !!localStorage.getItem('auth_tokens_v1');
    if (!hasTokens) {
      try { sessionStorage.setItem('redirectAfterLogin', `/conversation/${convId}`); } catch {}
      router.replace('/');
    }
  }, [convId, router]);
  

  // Fetch conversation + initial messages
  useEffect(() => {
    attachPrimingListeners();
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [c, msgs] = await Promise.all([
          apiClient.getConversation(convId),
          apiClient.getMessages(convId, 50, 0),
        ]);
        if (cancelled) return;
        setConv(c);
        const ordered = Array.isArray(msgs) ? msgs.sort((a:any,b:any)=> (a.id - b.id)) : [];
        setMessages(ordered);
        lastIdRef.current = ordered.length ? ordered[ordered.length-1].id : 0;
        // Scroll to bottom
        setTimeout(()=> listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 0);
      } catch (e:any) {
        setError(e?.message || 'تعذر تحميل المحادثة');
      } finally { setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [convId]);

  // Connect WS
  useEffect(() => {
    const { socket } = apiClient.connectSocketWithRetry(convId);
    wsRef.current = socket;
    if (socket) {
      socket.onmessage = (ev: MessageEvent) => {
        try {
          const data: any = JSON.parse(ev.data);
          // Handle read receipts from the other participant (assume current user is user_a)
          if (data?.type === 'chat.read') {
            if (data.reader && data.reader === conv?.user_b?.username) {
              const lr = Number(data.last_read_id || 0);
              if (!Number.isNaN(lr)) setLastReadByOther(prev => Math.max(prev, lr));
            }
            return;
          }
          if (data?.type === 'chat.message' || DEBUG_FORCE_APPEND) {
            const msg = {
              id: data.id || Date.now(),
              conversation: convId,
              sender: { username: data.sender },
              type: data.kind || 'text',
              body: data.body || '',
              created_at: data.created_at || new Date().toISOString(),
            } as Msg;
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev; // dedupe
              const next = [...prev, msg];
              // scroll bottom on new message
              setTimeout(()=> listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 0);
              lastIdRef.current = msg.id;
              // If received a message from the other participant, send read receipt when focused
              try {
                if (data.sender && data.sender === conv?.user_b?.username) {
                  if (typeof document !== 'undefined' && !document.hidden) {
                    wsRef.current?.send(JSON.stringify({ type: 'read', last_read_id: lastIdRef.current }));
                  }
                }
              } catch {}
              return next;
            });
            // Show centered alert for member add/remove system messages
            if (msg && typeof msg.body === 'string' && (msg.type === 'system' || /إزالة|إضافة/.test(msg.body))) {
              const mc = detectMemberChange(msg.body);
              if (mc) {
                const text = mc.action === 'removed'
                  ? `تمت إزالة ${mc.name || 'عضو'} من المحادثة`
                  : `تمت إضافة ${mc.name || 'عضو'} إلى المحادثة`;
                pushCenterAlert({ type: mc.action === 'removed' ? 'removed' : 'added', msg: text });
              }
            }
            // Play sound if tab is hidden (different page dedicated to this conversation)
            if (typeof document !== 'undefined' && document.hidden) {
              tryPlayMessageSound().catch(()=>{});
            }
          }
        } catch {}
      };
    }
    return () => { try { socket?.close(); } catch {} };
  }, [convId]);

  // Mark as read on focus
  useEffect(() => {
    const onFocus = () => {
      apiClient.readConversation?.(convId).catch(()=>{});
      try { wsRef.current?.send(JSON.stringify({ type: 'read', last_read_id: lastIdRef.current })); } catch {}
    };
    window.addEventListener('focus', onFocus);
    const id = setTimeout(onFocus, 600); // also try shortly after open
    return () => { window.removeEventListener('focus', onFocus); clearTimeout(id); };
  }, [convId]);

  if (loading) return <div className="min-h-screen bg-chatBg text-gray-100 p-4">جار التحميل...</div>;
  if (error) return <div className="min-h-screen bg-chatBg text-gray-100 p-4">{error}</div>;

  return (
    <div className="min-h-screen bg-chatBg text-gray-100 flex flex-col">
      <div className="p-3 border-b border-chatDivider bg-chatPanel sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <a href="/" className="text-gray-300 hover:text-white" title="رجوع">
            <svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/>
            </svg>
          </a>
          <div className="text-sm">محادثة #{convId}</div>
        </div>
      </div>
      <div ref={listRef} className="flex-1 max-w-4xl mx-auto w-full overflow-auto p-3 space-y-2">
        {messages.map(m => {
          const isMine = m.sender?.username === conv?.user_a?.username; // same assumption used for alignment
          const status: 'single'|'double'|'blue' = isMine
            ? (m.id <= lastReadByOther ? 'blue' : 'double')
            : 'double';
          return (
          <div key={m.id} className={isMine ? 'self-end text-left' : 'self-start text-right'}>
            <div className={"inline-block max-w-[75%] border rounded-2xl px-3 py-2 " + (isMine ? 'bg-emerald-700/30 border-white/10' : 'bg-white/5 border-white/10')}>
              <div className="text-xs text-gray-300 mb-1">{m.sender?.display_name || m.sender?.username || ''}</div>
              <div className="text-sm leading-relaxed break-words whitespace-normal" dir="auto">
                <bdi className="min-w-0 break-words" style={{unicodeBidi:'isolate'}}>{(m.body || '')}</bdi>
              </div>
              <div className="mt-1 text-[11px] opacity-70 flex items-center gap-1 justify-end" dir="auto">
                <span dir="ltr">{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                {isMine && <Ticks state={status} />}
              </div>
            </div>
          </div>
        )})}
      </div>
      {/* Centered Alerts Overlay */}
      {centerAlerts.length > 0 && (
        <div className="fixed inset-0 z-[60] pointer-events-none flex items-start justify-center pt-24">
          <div className="flex flex-col gap-2 w-full max-w-md px-4">
            {centerAlerts.map(a => (
              <div key={a.id} className={"mx-auto text-center px-4 py-3 rounded-lg border shadow-lg text-sm font-semibold w-full " + (a.type==='removed' ? 'bg-red-600/90 border-red-400 text-white' : a.type==='added' ? 'bg-green-600/90 border-green-400 text-white' : 'bg-gray-700/90 border-gray-500 text-white') }>
                {a.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
