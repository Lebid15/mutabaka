"use client";
import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { VAPID_PUBLIC_KEY } from '@/lib/config';
import { isSoundEnabled, setSoundEnabled, attachPrimingListeners, setRuntimeSoundUrl, tryPlayMessageSound } from '@/lib/sound';

export default function SettingsPage() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [soundEnabled, setSoundEnabledState] = useState(true);
  // TOTP
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSecret, setTotpSecret] = useState<string|null>(null);
  const [otpUri, setOtpUri] = useState<string|null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);

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

  // TOTP helpers
  useEffect(() => {
    (async () => {
      try { const s = await apiClient.getTotpStatus(); setTotpEnabled(!!s.enabled); } catch {}
    })();
  }, []);

  const setupTotp = async () => {
    setTotpBusy(true);
    try {
      const res = await apiClient.setupTotp();
      setTotpSecret(res.secret);
      setOtpUri(res.otpauth_uri);
    } catch (e:any) {
      alert(e?.message || 'تعذر إنشاء المفتاح');
    } finally {
      setTotpBusy(false);
    }
  };
  const enableTotp = async () => {
    try {
      const code = otpInput.trim();
      if (!/^[0-9]{6}$/.test(code)) { alert('أدخل رمزاً من 6 أرقام'); return; }
      const res = await apiClient.enableTotp(code);
      setTotpEnabled(!!res.enabled);
      if (res.enabled) alert('تم تفعيل المصادقة الثنائية');
    } catch (e:any) { alert(e?.message || 'تعذر التفعيل'); }
  };
  const disableTotp = async () => {
    try {
      const code = otpInput.trim();
      if (!/^[0-9]{6}$/.test(code)) { alert('أدخل رمزاً من 6 أرقام'); return; }
      const res = await apiClient.disableTotp(code);
      setTotpEnabled(!!res.enabled);
      if (!res.enabled) { setTotpSecret(null); setOtpUri(null); alert('تم إلغاء التفعيل'); }
    } catch (e:any) { alert(e?.message || 'تعذر الإلغاء'); }
  };

  return (
    <div className="min-h-screen bg-chatBg text-gray-100 p-4">
      <div className="max-w-2xl mx-auto bg-chatPanel border border-chatDivider rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <a href="/" className="text-gray-300 hover:text-white" title="رجوع">
            <svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/>
            </svg>
          </a>
          <h1 className="font-bold text-lg">الإعدادات</h1>
        </div>
        <div className="space-y-3">
          <div className="p-3 rounded border border-chatDivider">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold">الأمان: المصادقة الثنائية (TOTP)</div>
                <div className="text-xs text-gray-400">تعمل مع Google Authenticator أو تطبيقات مشابهة.</div>
                {totpEnabled ? (
                  <div className="text-xs text-emerald-400 mt-1">مفعّلة</div>
                ) : (
                  <div className="text-xs text-gray-400 mt-1">غير مفعّلة</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 min-w-[220px]">
                {!totpEnabled && (
                  <button disabled={totpBusy} onClick={setupTotp} className={"px-3 py-1 rounded text-sm "+(totpBusy? 'bg-emerald-600/60' : 'bg-emerald-600 hover:bg-emerald-700')}>{totpBusy? 'جارٍ…' : 'إنشاء مفتاح وQR'}</button>
                )}
                {totpEnabled && (
                  <div className="flex items-center gap-2">
                    <input value={otpInput} onChange={e=>setOtpInput(e.target.value)} placeholder="رمز 6 أرقام" className="w-28 bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 text-sm" />
                    <button onClick={disableTotp} className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm">إلغاء التفعيل</button>
                  </div>
                )}
              </div>
            </div>
            {(otpUri || totpSecret) && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                <div className="bg-white rounded p-2 flex items-center justify-center">
                  {/* Simple QR via external API without sending data; construct local data URL alternative */}
                  {otpUri && (
                    <img alt="QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpUri)}`} className="w-[180px] h-[180px]" />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-gray-300">Secret:</div>
                  <div className="flex items-center gap-2">
                    <code className="px-2 py-1 bg-black/40 rounded text-xs break-all">{totpSecret}</code>
                    <button onClick={()=>{ if (totpSecret) { navigator.clipboard.writeText(totpSecret); } }} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">نسخ</button>
                  </div>
                  {!totpEnabled && (
                    <div className="flex items-center gap-2">
                      <input value={otpInput} onChange={e=>setOtpInput(e.target.value)} placeholder="أدخل رمز 6 أرقام" className="w-40 bg-chatBg border border-chatDivider rounded px-2 py-1 text-gray-100 text-sm" />
                      <button onClick={enableTotp} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded text-sm">تفعيل</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="p-3 rounded border border-chatDivider">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">تشغيل صوت الإشعار</div>
                <div className="text-xs text-gray-400">عند وصول رسالة جديدة والتبويب غير مُركّز أو محادثة أخرى مفتوحة.</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={toggleSound} className={"px-3 py-1 rounded text-sm " + (soundEnabled? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-600 hover:bg-gray-700')}>
                  {soundEnabled ? 'مفعّل' : 'متوقف'}
                </button>
                <button onClick={async()=>{ const ok = await tryPlayMessageSound(); if (!ok) alert('قد يمنع المتصفح التشغيل التلقائي — انقر في الصفحة ثم حاول مجدداً'); }} className="px-3 py-1 rounded text-sm bg-white/10 hover:bg-white/20">تجربة الصوت</button>
              </div>
            </div>
            {/* intentionally no test sound button: single fixed sound, user can only enable/disable */}
          </div>
          <div className="p-3 rounded border border-chatDivider">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">إشعارات الرسائل (Web Push)</div>
                <div className="text-xs text-gray-400">يتطلب مفتاح VAPID عام و Service Worker. {VAPID_PUBLIC_KEY ? '' : '⚠️ مفقود NEXT_PUBLIC_VAPID_PUBLIC_KEY'}</div>
              </div>
              {supported ? (
                enabled ? (
                  <button disabled={busy} onClick={onDisable} className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm">إيقاف</button>
                ) : (
                  <button disabled={busy} onClick={onEnable} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded text-sm">تفعيل</button>
                )
              ) : (
                <span className="text-xs text-gray-400">المتصفح لا يدعم Push</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
