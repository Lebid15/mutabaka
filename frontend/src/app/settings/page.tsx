"use client";
import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { VAPID_PUBLIC_KEY } from '@/lib/config';
import { isSoundEnabled, setSoundEnabled, attachPrimingListeners, setRuntimeSoundUrl, tryPlayMessageSound } from '@/lib/sound';
import { useThemeMode } from '../theme-context';

export default function SettingsPage() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const { isLight, toggleTheme } = useThemeMode();

  const containerClass = isLight
    ? 'min-h-screen bg-[rgb(var(--color-chat-bg))] text-[#3c3127] p-4'
    : 'min-h-screen bg-chatBg text-gray-100 p-4';
  const panelClass = isLight
    ? 'max-w-2xl mx-auto bg-white/95 border border-[#f2cdaa] rounded-2xl p-5 shadow-sm'
    : 'max-w-2xl mx-auto bg-chatPanel border border-chatDivider rounded-lg p-4';
  const backLinkClass = isLight ? 'text-[#9a836f] hover:text-[#5d4838] transition' : 'text-gray-300 hover:text-white transition';
  const pageTitleClass = isLight ? 'font-bold text-lg text-[#3b2f24]' : 'font-bold text-lg';
  const cardClass = isLight
    ? 'p-4 rounded-2xl border border-[#f1c8a4] bg-white/95 shadow-sm'
    : 'p-3 rounded border border-chatDivider';
  const headingColor = isLight ? 'font-semibold text-[#43382d]' : 'font-semibold';
  const subTextColor = isLight ? 'text-xs text-[#7f6958]' : 'text-xs text-gray-400';
  const badgeActive = isLight
    ? 'text-xs text-[#1d7d53] mt-1'
    : 'text-xs text-emerald-400 mt-1';
  const badgeInactive = isLight
    ? 'text-xs text-[#9a8778] mt-1'
    : 'text-xs text-gray-400 mt-1';
  const inputClass = `rounded-lg px-3 py-2 text-sm transition focus:outline-none focus:ring-2 ${isLight
    ? 'bg-white border border-[#f1c59c] text-[#3d3227] placeholder:text-[#b29276] focus:border-[#eb9f5d] focus:ring-[#f8d5b3]/60 shadow-sm'
    : 'bg-chatBg border border-chatDivider text-gray-100 focus:border-emerald-500/50 focus:ring-emerald-500/20'}`;
  const pillButton = (variant: 'primary' | 'danger' | 'neutral' | 'ghost', disabled?: boolean) => {
    const base = 'px-3 py-1 rounded-lg text-sm font-medium transition shadow-sm disabled:opacity-60';
    if (variant === 'primary') {
      return `${base} ${isLight ? 'bg-[#2f9d73] text-white border border-[#bde5d1] hover:bg-[#258660]' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`;
    }
    if (variant === 'danger') {
      return `${base} ${isLight ? 'bg-[#ef5350] text-white border border-[#f8b7b5] hover:bg-[#dc4443]' : 'bg-red-600 hover:bg-red-700 text-white'}`;
    }
    if (variant === 'neutral') {
      return `${base} ${isLight ? 'bg-[#f8ede1] text-[#6b533d] border border-[#f0c8a0] hover:bg-[#f4e3d0]' : 'bg-gray-600 hover:bg-gray-700 text-white'}`;
    }
    return `${base} ${isLight ? 'bg-[#fff3e4] text-[#6f563e] border border-[#f1c8a4] hover:bg-[#ffe7cb]' : 'bg-white/10 hover:bg-white/20 text-gray-100'}`;
  };
  const copyButtonClass = isLight
    ? 'px-2 py-1 rounded-lg text-xs bg-[#fff3e4] hover:bg-[#ffe7cb] border border-[#f1c8a4] text-[#6f563e] transition'
    : 'px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition';
  const codeClass = isLight
    ? 'px-2 py-1 bg-[#2d3748]/5 border border-[#e3c7a6] rounded text-xs break-all text-[#3e3227]'
    : 'px-2 py-1 bg-black/40 rounded text-xs break-all';

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window);
  // sound
  setSoundEnabledState(isSoundEnabled());
  attachPrimingListeners();
  // load admin-configured sound url if present
  (async () => { try { const url = await apiClient.getNotificationSoundUrl(); if (url) setRuntimeSoundUrl(url); } catch {} })();
    // try detect existing subscription
    (async () => {
      try {
        const reg = await apiClient.registerServiceWorker();
        const sub = await reg?.pushManager.getSubscription();
        setEnabled(!!sub);
      } catch {}
    })();
  }, []);

  const onEnable = async () => {
    setBusy(true);
    try {
      const ok = await apiClient.enablePush();
      setEnabled(ok);
      if (!ok) alert('لم يتم تمكين الإشعارات');
    } catch (e:any) {
      alert(e?.message || 'فشل تفعيل الإشعارات');
    } finally { setBusy(false); }
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabledState(next);
    setSoundEnabled(next);
  };
  const onDisable = async () => {
    setBusy(true);
    try {
      await apiClient.disablePush();
      setEnabled(false);
    } catch { alert('تعذر الإيقاف'); } finally { setBusy(false); }
  };

  return (
    <div className={containerClass}>
      <div className={panelClass}>
        <div className="flex items-center gap-3 mb-4">
          <a href="/" className={backLinkClass} title="رجوع">
            <svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/>
            </svg>
          </a>
          <h1 className={pageTitleClass}>الإعدادات</h1>
        </div>
        <div className="space-y-4">
          <div className={cardClass}>
            <div className="flex items-center justify-between">
              <div>
                <div className={headingColor}>المظهر</div>
                <div className={subTextColor}>بدّل بين الوضعين الفاتح والداكن عبر التطبيق.</div>
              </div>
              <button
                onClick={toggleTheme}
                className={pillButton('primary')}
                title={isLight ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
              >
                {isLight ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
              </button>
            </div>
          </div>
          <div className={cardClass}>
            <div className="flex items-center justify-between">
              <div>
                <div className={headingColor}>تشغيل صوت الإشعار</div>
                <div className={subTextColor}>عند وصول رسالة جديدة والتبويب غير مُركّز أو محادثة أخرى مفتوحة.</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={toggleSound} className={soundEnabled ? pillButton('primary') : pillButton('neutral')}>
                  {soundEnabled ? 'مفعّل' : 'متوقف'}
                </button>
                <button onClick={async()=>{ const ok = await tryPlayMessageSound(); if (!ok) alert('قد يمنع المتصفح التشغيل التلقائي — انقر في الصفحة ثم حاول مجدداً'); }} className={pillButton('ghost')}>
                  تجربة الصوت
                </button>
              </div>
            </div>
            {/* intentionally no test sound button: single fixed sound, user can only enable/disable */}
          </div>
          <div className={cardClass}>
            <div className="flex items-center justify-between">
              <div>
                <div className={headingColor}>إشعارات الرسائل (Web Push)</div>
                <div className={subTextColor}>يتطلب مفتاح VAPID عام و Service Worker. {VAPID_PUBLIC_KEY ? '' : '⚠️ مفقود NEXT_PUBLIC_VAPID_PUBLIC_KEY'}</div>
              </div>
              {supported ? (
                enabled ? (
                  <button disabled={busy} onClick={onDisable} className={pillButton('danger')}>إيقاف</button>
                ) : (
                  <button disabled={busy} onClick={onEnable} className={pillButton('primary')}>تفعيل</button>
                )
              ) : (
                <span className={subTextColor}>المتصفح لا يدعم Push</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
