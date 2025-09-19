"use client";
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';

export default function ProfilePage() {
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string| null>(null);
  const [err, setErr] = useState<string| null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await apiClient.getProfile();
        setMe(data);
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
      const updated = await apiClient.updateProfile({ first_name: firstName, last_name: lastName, phone });
      setMe(updated);
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
    <div className="min-h-screen bg-chatBg text-gray-100 p-4">
      <div className="max-w-2xl mx-auto bg-chatPanel border border-chatDivider rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <a href="/" className="text-gray-300 hover:text-white" title="رجوع">
            <svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/>
            </svg>
          </a>
          <h1 className="font-bold text-lg">بروفايلي</h1>
        </div>
        {loading ? (
          <div className="text-xs text-gray-400">جاري التحميل…</div>
        ) : me ? (
          <div className="flex flex-col gap-4">
            {(msg || err) && (
              <div className={"text-xs px-3 py-2 rounded border " + (err ? 'bg-red-700/40 border-red-400 text-white' : 'bg-green-700/30 border-green-400 text-white')}>
                {err || msg}
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-gray-700 border border-chatDivider overflow-hidden flex items-center justify-center">
                {me.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.logo_url} alt="logo" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-lg font-bold">{(me.initials || me.username?.slice(0,2) || 'U').toUpperCase()}</span>
                )}
              </div>
              <label className="ml-2 inline-flex items-center gap-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2 py-1 cursor-pointer">
                <input type="file" className="hidden" accept="image/*" onChange={onPickPhoto} />
                {uploading ? 'جاري الرفع…' : 'تغيير صورة البروفايل'}
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">الاسم الأول</label>
                <input value={firstName} onChange={e=>setFirstName(e.target.value)} className="bg-chatBg border border-chatDivider rounded px-2 py-1" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">الاسم الأخير</label>
                <input value={lastName} onChange={e=>setLastName(e.target.value)} className="bg-chatBg border border-chatDivider rounded px-2 py-1" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">اسم المستخدم</label>
                <input value={me.username} disabled className="bg-chatBg border border-chatDivider rounded px-2 py-1 opacity-70" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">البريد الإلكتروني</label>
                <input value={me.email} disabled className="bg-chatBg border border-chatDivider rounded px-2 py-1 opacity-70" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">رقم الجوال</label>
                <input value={phone} onChange={e=>setPhone(e.target.value)} className="bg-chatBg border border-chatDivider rounded px-2 py-1" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">مدة الإشتراك المتبقية</label>
                <input value={(me.subscription_remaining_days ?? 0) + ' يوم'} disabled className="bg-chatBg border border-chatDivider rounded px-2 py-1 opacity-70" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveProfile} disabled={saving} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded px-3 py-2 text-sm">{saving ? '...' : 'حفظ'}</button>
            </div>

            <hr className="border-chatDivider/40" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">كلمة السر الحالية</label>
                <input type="password" value={oldPw} onChange={e=>setOldPw(e.target.value)} className="bg-chatBg border border-chatDivider rounded px-2 py-1" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">كلمة السر الجديدة</label>
                <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} className="bg-chatBg border border-chatDivider rounded px-2 py-1" />
              </div>
            </div>
            <div>
              <button onClick={changePassword} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded px-3 py-2 text-sm">تغيير كلمة السر</button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-gray-400">لا توجد بيانات</div>
        )}
      </div>
    </div>
  );
}
