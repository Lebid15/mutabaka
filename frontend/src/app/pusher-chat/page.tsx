"use client";
import { useEffect, useState } from 'react';
// import Pusher from 'pusher-js';

export default function PusherChatPage() {
  const [messages, setMessages] = useState<{username:string; message:string; conversationId?:number|null}[]>([]);
  const [username, setUsername] = useState('userA');
  const [text, setText] = useState('');
  const [conversationId, setConversationId] = useState<number|''>('');

  useEffect(() => {
    const key = (process.env.NEXT_PUBLIC_PUSHER_KEY as string) || '';
    const cluster = (process.env.NEXT_PUBLIC_PUSHER_CLUSTER as string) || '';
    if (!key || !cluster) {
      setMessages(prev => [{ username: 'system', message: 'Pusher disabled (missing key/cluster)', conversationId: null }, ...prev]);
      return;
    }
    let pusher: any = null;
    let channel: any = null;
    let channelName: string | null = null;
    (async () => {
      try {
        const mod = await import('pusher-js');
        const Pusher = (mod as any).default || (mod as any);
        pusher = new Pusher(key, { cluster });
        const convId = typeof conversationId === 'number' ? conversationId : null;
        channelName = convId ? `chat_${convId}` : 'chat';
        channel = pusher.subscribe(channelName);
        channel.bind('message', (data: any) => {
          setMessages(prev => [...prev, { username: data?.username, message: data?.message, conversationId: data?.conversationId ?? null }]);
        });
      } catch (e) {
        setMessages(prev => [{ username: 'system', message: `Pusher init failed: ${e}`, conversationId: null }, ...prev]);
      }
    })();
    return () => {
      try { channel && channel.unbind_all && channel.unbind_all(); } catch {}
      try { channelName && pusher && pusher.unsubscribe && pusher.unsubscribe(channelName); } catch {}
      try { pusher && pusher.disconnect && pusher.disconnect(); } catch {}
    };
  }, [conversationId]);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { username, message: text, conversation_id: typeof conversationId === 'number' ? conversationId : undefined };
    const res = await fetch(`${apiBase}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      alert('Send failed: ' + (err?.error || res.status));
    } else {
      setText('');
    }
  };

  return (
    <div className="min-h-screen p-6 bg-[#0f1f25] text-gray-100">
      <h1 className="text-lg font-bold mb-4">Pusher Chat (demo)</h1>
      <form onSubmit={send} className="flex gap-2 items-center mb-4">
        <input value={username} onChange={e=>setUsername(e.target.value)} className="px-2 py-1 rounded bg-white/10" placeholder="username" />
        <input value={text} onChange={e=>setText(e.target.value)} className="flex-1 px-2 py-1 rounded bg-white/10" placeholder="message" />
        <input value={conversationId} onChange={e=>{ const v=e.target.value; setConversationId(v===''? '' : (isNaN(+v)? '' : +v)); }} className="w-36 px-2 py-1 rounded bg-white/10" placeholder="conversationId (optional)" />
        <button className="px-3 py-1 bg-green-600 rounded">Send</button>
      </form>
      <div className="space-y-2">
        {messages.map((m,i)=> (
          <div key={i} className="p-2 bg-white/5 rounded border border-white/10">
            <div className="text-xs text-gray-300">{m.username}{m.conversationId? ` @${m.conversationId}`:''}</div>
            <div className="text-sm">{m.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
