"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { attachPrimingListeners, tryPlayMessageSound } from '@/lib/sound';
import { DEBUG_FORCE_APPEND } from '@/lib/config';

type Msg = { id:number; conversation:number; sender:any; type:'text'|'system'|'transaction'; body:string; created_at:string };

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

  // Redirect-to-login guard
  useEffect(() => {
    const hasTokens = typeof window !== 'undefined' && !!localStorage.getItem('auth_tokens_v1');
    if (!hasTokens) {
      try { sessionStorage.setItem('redirectAfterLogin', `/conversation/${convId}`); } catch {}
      router.replace('/login'); // adjust to your login route (landing page shows login form otherwise)
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
          const data = JSON.parse(ev.data);
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
              return next;
            });
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
    const onFocus = () => { apiClient.readConversation?.(convId).catch(()=>{}); };
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
        {messages.map(m => (
          <div key={m.id} className={m.sender?.username === conv?.user_a?.username ? 'self-end text-left' : 'self-start text-right'}>
            <div className="inline-block max-w-[80%] bg-white/5 border border-white/10 rounded-2xl px-3 py-2">
              <div className="text-xs text-gray-300 mb-1">{m.sender?.display_name || m.sender?.username || ''}</div>
              <div className="text-sm leading-relaxed inline-flex flex-wrap items-end" dir="auto">
                <span className="whitespace-pre-wrap break-words min-w-0">{(m.body || '').replace(/\s+$/,'')}</span><span className="ml-2 text-[10px] text-gray-400 whitespace-nowrap align-baseline" dir="ltr">{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
