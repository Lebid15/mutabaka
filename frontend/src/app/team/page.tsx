"use client";
import { ChangeEvent, useEffect, useState } from "react";
import { createTeamMember, deleteTeamMember, listTeam, updateTeamMember, TeamMember } from "@/lib/api-team";

export default function TeamPage() {
  const [token, setToken] = useState<string>("");
  const [items, setItems] = useState<TeamMember[]>([]);
  const [form, setForm] = useState({ username: "", display_name: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const access = parsed?.access as string | undefined;
      if (!access) return;
      setToken(access);
      listTeam(access).then(setItems).catch((e) => { try { console.error(e); } catch {} });
    } catch (e) { /* ignore */ }
  }, []);

  const add = async () => {
    setError(null);
    if (!token) { setError('لم يتم العثور على صلاحية الدخول. حاول تسجيل الدخول مجدداً.'); return; }
    if (!form.username.trim()) { setError('يرجى إدخال اسم المستخدم'); return; }
    try {
      setLoading(true);
      const created = await createTeamMember(token, form);
      setItems([created, ...items]);
      setForm({ username: "", display_name: "", phone: "" });
    } catch (e: any) {
      setError(e?.message || 'تعذر إضافة العضو');
    } finally { setLoading(false); }
  };
  const update = async (id: number, patch: Partial<{ display_name: string; phone: string }>) => {
    if (!token) return;
    const updated = await updateTeamMember(token, id, patch);
    setItems(items.map((it: TeamMember) => (it.id === id ? updated : it)));
  };
  const remove = async (id: number) => {
    if (!token) return;
    await deleteTeamMember(token, id);
    setItems(items.filter((it: TeamMember) => it.id !== id));
  };

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-bold text-lg text-gray-100">إنشاء فريق عمل</h1>
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
                <th className="px-3 py-2 font-normal w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-chatDivider/50">
              {items.map((it: TeamMember) => (
                <tr key={it.id} className="text-xs text-gray-100">
                  <td className="px-3 py-2">{it.member?.username}</td>
                  <td className="px-3 py-2">
                    <input className="w-full bg-chatBg border border-chatDivider rounded px-2 py-1 text-xs text-gray-100"
                      defaultValue={it.display_name}
                      onBlur={(e: ChangeEvent<HTMLInputElement>) => update(it.id, { display_name: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className="w-full bg-chatBg border border-chatDivider rounded px-2 py-1 text-xs text-gray-100"
                      defaultValue={it.phone}
                      onBlur={(e: ChangeEvent<HTMLInputElement>) => update(it.id, { phone: e.target.value })} />
                  </td>
                  <td className="px-3 py-2 text-left">
                    <button className="px-3 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white" onClick={() => remove(it.id)}>حذف</button>
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
