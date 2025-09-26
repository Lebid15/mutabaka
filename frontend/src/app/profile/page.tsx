"use client";
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useThemeMode } from '../theme-context';

export default function ProfilePage() {
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string| null>(null);
  const [err, setErr] = useState<string| null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [uploading, setUploading] = useState(false);
  const { isLight } = useThemeMode();

  const containerClass = isLight
    ? 'min-h-screen bg-[rgb(var(--color-chat-bg))] text-[#3d3227] p-4'
    : 'min-h-screen bg-chatBg text-gray-100 p-4';
  const panelClass = isLight
    ? 'max-w-2xl mx-auto bg-white/95 border border-[#f2cdaa] rounded-2xl p-5 shadow-sm'
    : 'max-w-2xl mx-auto bg-chatPanel border border-chatDivider rounded-lg p-4';
  const backLinkClass = isLight
    ? 'text-[#9a836f] hover:text-[#5d4838] transition'
    : 'text-gray-300 hover:text-white transition';
  const labelClass = isLight ? 'text-xs text-[#7f6857]' : 'text-xs text-gray-400';
  const inputClass = `rounded-lg px-3 py-2 text-sm transition focus:outline-none focus:ring-2 ${isLight
    ? 'bg-white border border-[#f1c59c] text-[#3d3227] placeholder:text-[#b29276] focus:border-[#eb9f5d] focus:ring-[#f9d5ae]/60 shadow-sm'
    : 'bg-chatBg border border-chatDivider text-gray-100 focus:border-emerald-500/50 focus:ring-emerald-500/20'}`;
  const readonlyInputClass = `${inputClass} opacity-70 cursor-not-allowed`;
  const primaryButtonClass = `rounded-lg px-4 py-2 text-sm font-semibold transition shadow-sm disabled:opacity-60 ${isLight
    ? 'bg-[#35b178] text-white border border-[#bce4cd] hover:bg-[#2da36c]'
    : 'bg-green-600 hover:bg-green-700 text-white'}`;
  const secondaryButtonClass = `rounded-lg px-4 py-2 text-sm font-semibold transition shadow-sm disabled:opacity-60 ${isLight
    ? 'bg-[#3d82f6] text-white border border-[#c5d9ff] hover:bg-[#2f6ee5]'
    : 'bg-blue-600 hover:bg-blue-700 text-white'}`;
  const linkButtonClass = isLight
    ? 'inline-flex items-center gap-2 text-xs bg-[#ffecd9] hover:bg-[#ffe0c2] border border-[#f0c8a0] rounded px-2 py-1 text-[#6f513a] cursor-pointer transition'
    : 'inline-flex items-center gap-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2 py-1 cursor-pointer transition';
  const cardDividerClass = isLight ? 'border-[#f2d5b6]/70' : 'border-chatDivider/40';
  const alertClass = (hasError: boolean) => hasError
    ? (isLight
        ? 'text-xs px-3 py-2 rounded border bg-[#fde6e3] border-[#f4b4aa] text-[#a43d32]'
        : 'text-xs px-3 py-2 rounded border bg-red-700/40 border-red-400 text-white')
    : (isLight
        ? 'text-xs px-3 py-2 rounded border bg-[#e7fbf3] border-[#b8ebd3] text-[#1d7d53]'
        : 'text-xs px-3 py-2 rounded border bg-green-700/30 border-green-400 text-white');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await apiClient.getProfile();
        setMe(data);
  setDisplayName(data.display_name || '');
        setFirstName(data.first_name || '');
        setLastName(data.last_name || '');
        setPhone(data.phone || '');
      } catch {
        setErr('تعذر تحميل المعلومات');
      } finally { setLoading(false); }
    })();
  }, []);

  const saveProfile = async () => {
    try {
      setSaving(true); setMsg(null); setErr(null);
  const updated = await apiClient.updateProfile({ first_name: firstName, last_name: lastName, phone, display_name: displayName });
      setMe(updated);
  setDisplayName(updated.display_name || '');
      setMsg('تم الحفظ');
    } catch (e: any) {
      setErr(e?.message || 'فشل الحفظ');
    } finally { setSaving(false); }
  };

  const changePassword = async () => {
    try {
      setSaving(true); setMsg(null); setErr(null);
      if (!oldPw || !newPw) { setErr('يرجى إدخال كلمة المرور الحالية والجديدة'); setSaving(false); return; }
      await apiClient.changePassword(oldPw, newPw);
      setMsg('تم تغيير كلمة السر');
      setOldPw(''); setNewPw('');
    } catch (e: any) {
      setErr(e?.message || 'فشل تغيير كلمة السر');
    } finally { setSaving(false); }
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setUploading(true); setMsg(null); setErr(null);
      const res = await apiClient.uploadProfilePhoto(f);
      setMe((prev: any) => ({ ...prev, logo_url: res.logo_url }));
      setMsg('تم تحديث الصورة');
    } catch (e: any) {
      setErr(e?.message || 'فشل رفع الصورة');
    } finally { setUploading(false); }
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
          <h1 className={`font-bold text-lg ${isLight ? 'text-[#3b2f24]' : ''}`}>بروفايلي</h1>
        </div>
        {loading ? (
          <div className={`text-xs ${isLight ? 'text-[#988576]' : 'text-gray-400'}`}>جاري التحميل…</div>
        ) : me ? (
          <div className="flex flex-col gap-4">
            {(msg || err) && (
              <div className={alertClass(!!err)}>{err || msg}</div>
            )}
            <div className="flex items-center gap-3">
              <div className={`w-16 h-16 rounded-full overflow-hidden flex items-center justify-center border ${isLight ? 'bg-[#f6dcc2] border-[#e7c19f]' : 'bg-gray-700 border-chatDivider'}`}>
                {me.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.logo_url} alt="logo" className="w-full h-full object-cover" />
                ) : (
                  <span className={`text-lg font-bold ${isLight ? 'text-[#4f3c2b]' : ''}`}>{(me.initials || me.username?.slice(0,2) || 'U').toUpperCase()}</span>
                )}
              </div>
              <label className={`ml-2 ${linkButtonClass}`}>
                <input type="file" className="hidden" accept="image/*" onChange={onPickPhoto} />
                {uploading ? 'جاري الرفع…' : 'تغيير صورة البروفايل'}
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <label className={labelClass}>الاسم الظاهر</label>
                <input value={displayName} onChange={e=>setDisplayName(e.target.value)} className={inputClass} placeholder="الاسم الذي يظهر في الدردشة" />
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>الاسم الأول</label>
                <input value={firstName} onChange={e=>setFirstName(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>الاسم الأخير</label>
                <input value={lastName} onChange={e=>setLastName(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>اسم المستخدم</label>
                <input value={me.username} disabled className={readonlyInputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>البريد الإلكتروني</label>
                <input value={me.email} disabled className={readonlyInputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>رقم الجوال</label>
                <input value={phone} onChange={e=>setPhone(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>مدة الإشتراك المتبقية</label>
                <input value={(me.subscription_remaining_days ?? 0) + ' يوم'} disabled className={readonlyInputClass} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveProfile} disabled={saving} className={primaryButtonClass}>{saving ? '...' : 'حفظ'}</button>
            </div>

            <hr className={`border ${cardDividerClass}`} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <label className={labelClass}>كلمة السر الحالية</label>
                <input type="password" value={oldPw} onChange={e=>setOldPw(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>كلمة السر الجديدة</label>
                <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <button onClick={changePassword} disabled={saving} className={secondaryButtonClass}>تغيير كلمة السر</button>
            </div>
          </div>
        ) : (
          <div className={`text-xs ${isLight ? 'text-[#9a887a]' : 'text-gray-400'}`}>لا توجد بيانات</div>
        )}
      </div>
    </div>
  );
}
