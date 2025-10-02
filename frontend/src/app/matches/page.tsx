"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { useThemeMode } from '../theme-context';

type Row = { name: string; avatar?: string; usd: number; tryy: number; syp: number; eur: number };

const fmt = (n: number) => {
  if (!isFinite(n)) return '0.00';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const s = abs.toFixed(5).replace(/0+$/,'').replace(/\.$/,'');
  const parts = s.split('.');
  if (parts.length === 1) return sign + parts[0] + '.00';
  if (parts[1].length === 1) return sign + parts[0] + '.' + parts[1] + '0';
  return sign + s;
};

// Treat special admin-like usernames as admin accounts to be hidden
function isAdminLike(u?: string | null) {
  const n = (u || '').toLowerCase();
  return n === 'admin' || n === 'madmin' || n === 'a_admin' || n === 'l_admin';
}

export default function MatchesPage() {
  const { isLight } = useThemeMode();
  // Avoid hydration mismatch: don't branch on client-only state until mounted
  const [mounted, setMounted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [profile, setProfile] = useState<any|null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Redirect team-member accounts away from this page
  useEffect(() => {
    if (!mounted) return;
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('auth_tokens_v1') : null;
      const access = raw ? (JSON.parse(raw).access as string) : '';
      if (access) {
        const base64 = access.split('.')[1];
        if (base64) {
          const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
          const payload = JSON.parse(json);
          if (payload && payload.actor === 'team_member') {
            setBlocked(true);
            if (typeof window !== 'undefined') window.location.replace('/');
          }
        }
      }
    } catch {}
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return; // run only on client after mount
    if (blocked) return; // do not load for team members
    if (!apiClient.access) { // if not authenticated, skip fetching
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const me = await apiClient.getProfile();
        if (!active) return;
        setProfile(me);
        const convs = await apiClient.listConversations();
        if (!active) return;
        const acc: Record<number, Row> = {};
        for (const c of convs || []) {
          const userA = c.user_a; const userB = c.user_b;
          const amUserA = me && userA && me.id === userA.id;
          const other = amUserA ? userB : userA;
          if (!other) continue;
          // Skip admin-like accounts entirely
          if (isAdminLike(other.username) || isAdminLike(other.display_name)) continue;
          const otherName = other.display_name || other.username || other.email || 'مستخدم';
          const otherAvatar = other.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.display_name || other.username || 'U')}&background=0D8ABC&color=fff`;
          const nb = await apiClient.getNetBalance(c.id).catch(()=>null);
          if (!nb || !nb.net) continue;
          let row = acc[c.id];
          if (!row) { row = acc[c.id] = { name: otherName, avatar: otherAvatar, usd: 0, tryy: 0, syp: 0, eur: 0 }; }
          for (const item of nb.net) {
            const code = item.currency?.code;
            const v = parseFloat(item.net_from_user_a_perspective);
            const val = amUserA ? v : -v; // اجعلها من منظور المستخدم الحالي
            if (code === 'USD') row.usd += val;
            else if (code === 'TRY') row.tryy += val;
            else if (code === 'SYP') row.syp += val;
            else if (code === 'EUR') row.eur += val;
          }
        }
        const list = Object.values(acc);
        if (!active) return;
        setRows(list);
      } catch (e:any) {
        setError(e?.message || 'فشل التحميل');
      } finally {
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [mounted]);

  const displayRows = useMemo(() => rows.filter(r => !isAdminLike(r.name)), [rows]);

  const totals = useMemo(() => {
    return displayRows.reduce((t, r) => ({
      usd: t.usd + r.usd,
      tryy: t.tryy + r.tryy,
      syp: t.syp + r.syp,
      eur: t.eur + r.eur,
    }), { usd: 0, tryy: 0, syp: 0, eur: 0 });
  }, [displayRows]);

  const exportToExcel = useCallback(async () => {
    if (!displayRows.length) return;

    const excelModule = await import('exceljs');
    const WorkbookCtor = (excelModule as any).Workbook || (excelModule as any).default?.Workbook;
    if (!WorkbookCtor) {
      throw new Error('ExcelJS Workbook not available');
    }

    const workbook = new WorkbookCtor();
    workbook.creator = 'Mutabaka';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('مطابقاتي', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 6 }],
      properties: { defaultRowHeight: 22 },
    });

    sheet.columns = [
      { key: 'entity', width: 22 },
      { key: 'usd', width: 16 },
      { key: 'try', width: 16 },
      { key: 'syp', width: 16 },
      { key: 'eur', width: 16 },
    ];

    const blueFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } } as const;
    const blueFillAlt = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } } as const;
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } } as const;
    const entityFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE7D6' } } as const;
    const zebraA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as const;
    const zebraB = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } } as const;

    sheet.addRow([]); // فراغ علوي
    sheet.mergeCells('A2:E2');
    const titleCell = sheet.getCell('A2');
    titleCell.value = 'مطابقاتي';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = blueFill;
    sheet.getRow(2).height = 30;

    const summaryHeaders = [
      { col: 'B', label: 'دولار' },
      { col: 'C', label: 'تركي' },
      { col: 'D', label: 'سوري' },
      { col: 'E', label: 'يورو' },
    ] as const;

    const applyBorders = (cell: any) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    };

    const labelCellFont = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } } as const;

    const labelCurrencyCells = summaryHeaders.map((item) => sheet.getCell(`${item.col}3`));
    sheet.getCell('A3').value = 'العملة';
    sheet.getCell('A3').fill = blueFillAlt;
    sheet.getCell('A3').font = labelCellFont;
    sheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
    applyBorders(sheet.getCell('A3'));

    summaryHeaders.forEach((item, idx) => {
      const cell = labelCurrencyCells[idx];
      cell.value = item.label;
      cell.font = { bold: true, color: { argb: 'FF1F2937' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = headerFill;
      applyBorders(cell);
    });

    sheet.getCell('A4').value = 'القيمة';
    sheet.getCell('A4').fill = blueFillAlt;
    sheet.getCell('A4').font = labelCellFont;
    sheet.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };
    applyBorders(sheet.getCell('A4'));

    const summaryValues = [
      { col: 'B', value: totals.usd, symbol: '$' },
      { col: 'C', value: totals.tryy, symbol: '₺' },
      { col: 'D', value: totals.syp, symbol: 'SYP' },
      { col: 'E', value: totals.eur, symbol: '€' },
    ];

    summaryValues.forEach((item) => {
      const cell = sheet.getCell(`${item.col}4`);
      const numeric = item.value ?? 0;
      const formatted = `${fmt(numeric)} ${item.symbol}`;
      cell.value = formatted;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = {
        bold: true,
        color: {
          argb: numeric < 0 ? 'FFE11D48' : numeric > 0 ? 'FF16A34A' : 'FF1F2937',
        },
      };
      applyBorders(cell);
    });

    const spacerRow = sheet.getRow(5);
    spacerRow.height = 8;

    sheet.getCell('A6').value = 'الجهة';
    sheet.getCell('A6').fill = headerFill;
    sheet.getCell('A6').font = { bold: true, color: { argb: 'FF1F2937' } };
    sheet.getCell('A6').alignment = { horizontal: 'center', vertical: 'middle' };
    applyBorders(sheet.getCell('A6'));

    summaryHeaders.forEach((item, idx) => {
      const cell = sheet.getCell(`${item.col}6`);
      cell.value = item.label;
      cell.font = { bold: true, color: { argb: 'FF1F2937' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = headerFill;
      applyBorders(cell);
    });

    displayRows.forEach((row, idx) => {
      const excelRowNumber = 7 + idx;
      const dataRow = sheet.getRow(excelRowNumber);
      dataRow.height = 22;
      const zebra = idx % 2 === 0 ? zebraA : zebraB;

      const entityCell = dataRow.getCell('A');
      entityCell.value = row.name;
      entityCell.fill = entityFill;
      entityCell.font = { bold: true, color: { argb: 'FF1F2937' } };
      entityCell.alignment = { horizontal: 'center', vertical: 'middle' };
      applyBorders(entityCell);

      const amounts = [
        { col: 'B', value: row.usd, symbol: '$' },
        { col: 'C', value: row.tryy, symbol: '₺' },
        { col: 'D', value: row.syp, symbol: 'SYP' },
        { col: 'E', value: row.eur, symbol: '€' },
      ];

      amounts.forEach((amount) => {
        const cell = dataRow.getCell(amount.col);
        const numeric = amount.value ?? 0;
        cell.value = `${fmt(numeric)} ${amount.symbol}`;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = {
          color: {
            argb: numeric < 0 ? 'FFE11D48' : numeric > 0 ? 'FF16A34A' : 'FF1F2937',
          },
        };
        cell.fill = zebra;
        applyBorders(cell);
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `matches-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [displayRows, totals]);

  // Render a stable placeholder during SSR and before mount to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen bg-chatBg text-gray-100 p-0 md:p-4">
        <div className="w-full max-w-7xl mx-auto border border-chatDivider rounded-lg overflow-hidden shadow-xl bg-chatBg">
          <div className="bg-chatPanel border-b border-chatDivider px-6 py-3 flex items-center gap-3">
            <div className="h-4 w-24 bg-white/10 rounded" />
          </div>
          <div className="p-4 md:p-6 text-xs text-gray-400">جارٍ التحميل…</div>
        </div>
      </div>
    );
  }

  if (!apiClient.access || blocked) {
    return (
      <div className="min-h-screen bg-chatBg text-gray-100 flex items-center justify-center p-6">
        <div className="bg-chatPanel border border-chatDivider rounded-lg p-6 max-w-md w-full text-center">
          <div className="font-bold mb-2">{blocked ? 'هذه الصفحة متاحة فقط للمالك' : 'الرجاء تسجيل الدخول أولاً'}</div>
          <a href="/" className="text-sm text-green-400 hover:underline">الانتقال للصفحة الرئيسية</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chatBg text-gray-100 p-0 md:p-4">
      <div className="w-full max-w-7xl mx-auto border border-chatDivider rounded-lg overflow-hidden shadow-xl bg-chatBg">
        <div className="bg-chatPanel border-b border-chatDivider px-6 py-3 flex items-center gap-3">
          <a href="/" className="text-gray-300 hover:text-white" title="رجوع">
            <svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/></svg>
          </a>
          <div className="font-bold">مطابقاتي</div>
          <button
            onClick={exportToExcel}
            disabled={!displayRows.length}
            className={`ml-auto text-xs md:text-sm px-3 py-1.5 rounded border border-teal-500 hover:bg-teal-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${isLight ? 'text-teal-700 bg-white/70 hover:bg-teal-500/10' : 'text-teal-200'}`}
          >
            تصدير إلى إكسل
          </button>
          <div className="ml-3 text-xs text-gray-400">{profile?.display_name || profile?.username}</div>
        </div>

        <div className="p-4 md:p-6">
          {loading && <div className="text-xs text-gray-400">جاري التحميل…</div>}
          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg border border-teal-700/40 bg-teal-900/40 p-3">
              <div className="text-[11px] text-gray-300 mb-1">دولار</div>
              <div className="font-semibold tabular-nums" dir="ltr">{fmt(totals.usd)} $</div>
            </div>
            <div className="rounded-lg border border-teal-700/40 bg-teal-900/40 p-3">
              <div className="text-[11px] text-gray-300 mb-1">تركي</div>
              <div className="font-semibold tabular-nums" dir="ltr">{fmt(totals.tryy)} ₺</div>
            </div>
            <div className="rounded-lg border border-teal-700/40 bg-teal-900/40 p-3">
              <div className="text-[11px] text-gray-300 mb-1">سوري</div>
              <div className="font-semibold tabular-nums" dir="ltr">{fmt(totals.syp)} SYP</div>
            </div>
            <div className="rounded-lg border border-teal-700/40 bg-teal-900/40 p-3">
              <div className="text-[11px] text-gray-300 mb-1">يورو</div>
              <div className="font-semibold tabular-nums" dir="ltr">{fmt(totals.eur)} €</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table-auto min-w-[720px] md:min-w-full text-xs md:text-sm">
              <thead className="bg-chatPanel/70 border border-chatDivider">
                <tr>
                  <th className="text-left px-3 py-2 whitespace-nowrap first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40">
                    <div className="flex items-center justify-start gap-2">
                      <span aria-hidden className="inline-block w-6 h-6"></span>
                      <span>الجهة</span>
                    </div>
                  </th>
                  <th className="text-center px-3 py-2 whitespace-nowrap first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40">دولار</th>
                  <th className="text-center px-3 py-2 whitespace-nowrap first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40">تركي</th>
                  <th className="text-center px-3 py-2 whitespace-nowrap first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40">سوري</th>
                  <th className="text-center px-3 py-2 whitespace-nowrap first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40">يورو</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r, idx) => (
                  <tr key={idx} className="border-b border-chatDivider/50 hover:bg-white/5">
                    <td className="px-3 py-2 text-left first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40">
                      <div className="flex items-center justify-start gap-2">
                        <img src={r.avatar} alt={r.name} className="w-6 h-6 rounded-full border border-chatDivider" />
                        <span className="font-semibold">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-center first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40" dir="ltr"><span className="tabular-nums">{fmt(r.usd)} $</span></td>
                    <td className="px-3 py-2 whitespace-nowrap text-center first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40" dir="ltr"><span className="tabular-nums">{fmt(r.tryy)} ₺</span></td>
                    <td className="px-3 py-2 whitespace-nowrap text-center first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40" dir="ltr"><span className="tabular-nums">{fmt(r.syp)} SYP</span></td>
                    <td className="px-3 py-2 whitespace-nowrap text-center first:border-l-0 rtl:first:border-r-0 border-l rtl:border-r border-chatDivider/40" dir="ltr"><span className="tabular-nums">{fmt(r.eur)} €</span></td>
                  </tr>
                ))}
                {displayRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-400">لا توجد بيانات مطابقة بعد</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
