"use client";
import { ChangeEvent, useEffect, useState } from "react";
import { createTeamMember, deleteTeamMember, listTeam, updateTeamMember, TeamMember } from "@/lib/api-team";

export default function TeamPage() {
  const [token, setToken] = useState<string>("");
  const [items, setItems] = useState<TeamMember[]>([]);
  const [form, setForm] = useState({ username: "", display_name: "", phone: "" });

  useEffect(() => {
    const t = localStorage.getItem("jwt");
    if (t) {
      setToken(t);
      listTeam(t).then(setItems).catch(console.error);
    }
  }, []);

  const add = async () => {
    if (!token) return;
    const created = await createTeamMember(token, form);
    setItems([created, ...items]);
    setForm({ username: "", display_name: "", phone: "" });
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
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">إنشاء فريق عمل</h1>
      <div className="flex gap-2 items-end">
        <div>
          <label className="block text-sm">اسم المستخدم</label>
          <input className="input input-bordered" value={form.username} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm">الاسم الظاهر</label>
          <input className="input input-bordered" value={form.display_name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, display_name: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm">رقم الهاتف</label>
          <input className="input input-bordered" value={form.phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <button className="btn btn-primary" onClick={add}>أضف عضو</button>
      </div>

      <table className="table w-full">
        <thead>
          <tr>
            <th>المستخدم</th>
            <th>الاسم الظاهر</th>
            <th>رقم الهاتف</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it: TeamMember) => (
            <tr key={it.id}>
              <td>{it.member?.username}</td>
              <td>
                <input className="input input-bordered" defaultValue={it.display_name}
                  onBlur={(e: ChangeEvent<HTMLInputElement>) => update(it.id, { display_name: e.target.value })} />
              </td>
              <td>
                <input className="input input-bordered" defaultValue={it.phone}
                  onBlur={(e: ChangeEvent<HTMLInputElement>) => update(it.id, { phone: e.target.value })} />
              </td>
              <td>
                <button className="btn btn-error btn-sm" onClick={() => remove(it.id)}>حذف</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
