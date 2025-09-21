"use client";
import { ChangeEvent, useEffect, useState } from "react";
import { createTeamMember, deleteTeamMember, listTeam, updateTeamMember, TeamMember } from "@/lib/api-team";

export default function TeamPage() {
  const [mounted, setMounted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [token, setToken] = useState<string>("");
  const [items, setItems] = useState<TeamMember[]>([]);
  const [form, setForm] = useState({ username: "", display_name: "", phone: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ display_name: string; phone: string }>({ display_name: "", phone: "" });

  useEffect(() => { setMounted(true); }, []);

  // Redirect team-member accounts away from this page
  useEffect(() => {
    if (!mounted) return;
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const access = parsed?.access as string | undefined;
      if (!access) return;
      const base64 = access.split('.')[1];
      if (base64) {
        const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json);
        if (payload && payload.actor === 'team_member') {
          setBlocked(true);
          if (typeof window !== 'undefined') window.location.replace('/');
          return;
        }
      }
      setToken(access);
      listTeam(access).then(setItems).catch((e) => { try { console.error(e); } catch {} });
    } catch (e) { /* ignore */ }
  }, [mounted]);

  const add = async () => {
    setError(null);
    if (!token) { setError('لم يتم العثور على صلاحية الدخول. حاول تسجيل الدخول مجدداً.'); return; }
    if (!form.username.trim()) { setError('يرجى إدخال اسم المستخدم'); return; }
    // Latin-only validation (A-Z/a-z)
    if (!/^[A-Za-z]+$/.test(form.username.trim())) {
      setError('اسم المستخدم يجب أن يتكون من أحرف لاتينية فقط (A-Z) دون أرقام أو مسافات');
      return;
    }
    if (!form.password.trim()) { setError('يرجى إدخال كلمة المرور'); return; }
    try {
      setLoading(true);
      const created = await createTeamMember(token, form);
      setItems([created, ...items]);
      setForm({ username: "", display_name: "", phone: "", password: "" });
    } catch (e: any) {
      setError(e?.message || 'تعذر إضافة العضو');
    } finally { setLoading(false); }
  };

  const update = async (id: number, patch: Partial<{ display_name: string; phone: string }>) => {
    if (!token) return;
    const updated = await updateTeamMember(token, id, patch);
    setItems(items.map((it: TeamMember) => (it.id === id ? updated : it)));
  };

  const startEdit = (it: TeamMember) => {
    setEditingId(it.id);
    setEditDraft({ display_name: it.display_name || "", phone: it.phone || "" });
  };

  const saveEdit = async () => {
    if (!token || editingId === null) return;
    try {
      await update(editingId, { display_name: editDraft.display_name, phone: editDraft.phone });
    } finally {
      setEditingId(null);
    }
  };

  const cancelEdit = () => setEditingId(null);

  const remove = async (id: number) => {
    if (!token) return;
    await deleteTeamMember(token, id);
    setItems(items.filter((it: TeamMember) => it.id !== id));
  };

  if (!token || blocked) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-5xl mb-4">
          <div className="bg-chatPanel border border-chatDivider rounded-lg p-4 text-center">
            <div className="font-bold mb-1">{blocked ? 'هذه الصفحة متاحة فقط للمالك' : 'الرجاء تسجيل الدخول أولاً'}</div>
            <a href="/" className="text-sm text-green-400 hover:underline">الانتقال للصفحة الرئيسية</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (typeof window !== 'undefined' ? window.history.back() : null)}
              className="inline-flex items-center justify-center w-8 h-8 rounded border border-chatDivider text-gray-300 hover:text-white hover:bg-chatBg"
              aria-label="رجوع"
              title="رجوع"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="font-bold text-lg text-gray-100">إنشاء فريق عمل</h1>
          </div>
        </div>

        <div className="bg-chatPanel border border-chatDivider rounded-lg p-4">
          <form onSubmit={(e)=>{ e.preventDefault(); add(); }} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="block text-xs text-gray-300 mb-1">اسم المستخدم</label>
              <input
                placeholder="example"
                className="w-full bg-chatBg border border-chatDivider rounded px-3 py-2 text-xs text-gray-100 placeholder:text-gray-400"
                value={form.username}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs text-gray-300 mb-1">الاسم الظاهر</label>
              <input
                placeholder="الاسم الظاهر"
                className="w-full bg-chatBg border border-chatDivider rounded px-3 py-2 text-xs text-gray-100 placeholder:text-gray-400"
                value={form.display_name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, display_name: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs text-gray-300 mb-1">رقم الهاتف</label>
              <input
                placeholder="05555"
                className="w-full bg-chatBg border border-chatDivider rounded px-3 py-2 text-xs text-gray-100 placeholder:text-gray-400"
                value={form.phone}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs text-gray-300 mb-1">كلمة المرور</label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full bg-chatBg border border-chatDivider rounded px-3 py-2 text-xs text-gray-100 placeholder:text-gray-400"
                value={form.password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="md:col-span-1">
              <button type="submit" onClick={add} disabled={loading} className="w-full px-3 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-xs">أضف عضو</button>
              {error && <div className="text-[11px] text-red-300 mt-2">{error}</div>}
            </div>
          </form>
        </div>

        <div className="mt-4 bg-chatPanel border border-chatDivider rounded-lg overflow-hidden">
          <table className="w-full text-right">
            <thead className="bg-chatBg border-b border-chatDivider">
              <tr className="text-xs text-gray-300">
                <th className="px-3 py-2 font-normal">المستخدم</th>
                <th className="px-3 py-2 font-normal">الاسم الظاهر</th>
                <th className="px-3 py-2 font-normal">رقم الهاتف</th>
                <th className="px-3 py-2 font-normal w-40"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-chatDivider/50">
              {items.map((it: TeamMember) => (
                <tr key={it.id} className="text-xs text-gray-100">
                  <td className="px-3 py-2">{it.username}</td>
                  <td className="px-3 py-2">
                    <input
                      className="w-full bg-chatBg border border-chatDivider rounded px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
                      value={editingId === it.id ? editDraft.display_name : (it.display_name || "")}
                      readOnly={editingId !== it.id}
                      disabled={editingId !== it.id}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setEditDraft((d) => ({ ...d, display_name: e.target.value }))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-full bg-chatBg border border-chatDivider rounded px-2 py-1 text-xs text-gray-100 disabled:opacity-60"
                      value={editingId === it.id ? editDraft.phone : (it.phone || "")}
                      readOnly={editingId !== it.id}
                      disabled={editingId !== it.id}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
                    />
                  </td>
                  <td className="px-3 py-2 text-left space-x-2 space-x-reverse">
                    {editingId === it.id ? (
                      <>
                        <button className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white ml-2" onClick={saveEdit}>حفظ</button>
                        <button className="px-3 py-1 rounded bg-gray-600/80 hover:bg-gray-600 text-white ml-2" onClick={cancelEdit}>إلغاء</button>
                        <button className="px-3 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white" onClick={() => remove(it.id)}>حذف</button>
                      </>
                    ) : (
                      <>
                        <button className="px-3 py-1 rounded bg-blue-600/80 hover:bg-blue-600 text-white ml-2" onClick={() => startEdit(it)}>تعديل</button>
                        <button className="px-3 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white" onClick={() => remove(it.id)}>حذف</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[11px] text-gray-400">لا يوجد أعضاء بعد</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
