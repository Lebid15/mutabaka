"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { useThemeMode } from '../theme-context';

type PlanCode = 'silver'|'golden'|'king';

// Arabic labels for plan codes
const PLAN_AR: Record<PlanCode, string> = {
  silver: 'فضي',
  golden: 'ذهبي',
  king: 'ملكي',
};

const planLabel = (code?: string) => {
  if (!code) return '—';
  const c = code as PlanCode;
  return (PLAN_AR as any)[c] || code;
}
// Prefer plan.name (from backend/admin), fallback to Arabic label by code
const planNameOrLabel = (plan?: { name?: string; code?: string }) => {
  return plan?.name?.trim() || planLabel(plan?.code);
}

// Render status with Arabic labels; "active" shown as green "نشط"
// Format date/time in English with day-month-year order and 24h time
const formatDateTimeEn = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  try {
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return d.toISOString();
  }
}

export default function SubscriptionsPage() {
  const [mounted, setMounted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [sub, setSub] = useState<any|null>(null);
  const [pending, setPending] = useState<any|null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>('silver');
  const [busy, setBusy] = useState(false);
  const { isLight } = useThemeMode();

  const statusLabel = (s?: string) => {
    if (!s) return <span className={isLight ? 'text-[#9f8c7c]' : 'text-gray-300'}>غير معروف</span>;
    if (s === 'active') return <span className={isLight ? 'text-[#207650] font-semibold' : 'text-green-400 font-semibold'}>نشط</span>;
    if (s === 'expired') return <span className={isLight ? 'text-[#d1433f]' : 'text-red-400'}>منتهي</span>;
    if (s === 'cancelled') return <span className={isLight ? 'text-[#9f8c7c]' : 'text-gray-400'}>ملغي</span>;
    return <span className={isLight ? 'text-[#9f8c7c]' : 'text-gray-300'}>{s}</span>;
  };

  const containerClass = isLight
    ? 'min-h-screen bg-[rgb(var(--color-chat-bg))] text-[#3c3127] p-4'
    : 'min-h-screen bg-chatBg text-gray-100 p-4';
  const panelClass = isLight
    ? 'max-w-2xl mx-auto bg-white/95 border border-[#f2cdaa] rounded-2xl p-5 shadow-sm'
    : 'max-w-2xl mx-auto bg-chatPanel border border-chatDivider rounded-lg p-4';
  const backLinkClass = isLight ? 'text-[#9a836f] hover:text-[#5d4838] transition' : 'text-gray-300 hover:text-white transition';
  const titleClass = isLight ? 'font-bold text-lg text-[#3b2f24]' : 'font-bold text-lg';
  const tableWrapperClass = isLight
    ? 'rounded-2xl overflow-hidden border border-[#f1c8a4] bg-white shadow-sm'
    : 'rounded-lg overflow-hidden border border-chatDivider bg-[#0e1b22]/70 backdrop-blur-sm';
  const tableHeaderClass = isLight
    ? 'grid grid-cols-3 text-center bg-[#fff3e4] border-b border-[#f1c8a4] text-[13px]'
    : 'grid grid-cols-3 text-center bg-white/10 border-b border-chatDivider text-[13px]';
  const tableRowClass = isLight
    ? 'grid grid-cols-3 text-center border-b border-[#f3d8bb] text-xs divide-x divide-[#f3d8bb]'
    : 'grid grid-cols-3 text-center border-b border-chatDivider text-xs divide-x divide-chatDivider/60';
  const tableRowLastClass = isLight
    ? 'grid grid-cols-3 text-center text-xs divide-x divide-[#f3d8bb]'
    : 'grid grid-cols-3 text-center text-xs divide-x divide-chatDivider/60';
  const metaCardClass = isLight
    ? 'p-4 rounded-2xl border border-[#f1c8a4] bg-white/95 shadow-sm'
    : 'p-3 rounded border border-chatDivider';
  const metaLabelClass = isLight ? 'text-[#7f6958]' : 'text-gray-400';
  const selectClass = `rounded-lg px-3 py-2 text-sm transition focus:outline-none focus:ring-2 ${isLight
    ? 'bg-white border border-[#f1c59c] text-[#3d3227] focus:border-[#eb9f5d] focus:ring-[#f8d5b3]/60 shadow-sm'
    : 'bg-chatBg border border-chatDivider text-gray-100 focus:border-emerald-500/50 focus:ring-emerald-500/20'}`;
  const buttonClass = (variant: 'primary' | 'secondary') => {
    const base = 'px-3 py-2 rounded-lg text-sm font-semibold transition shadow-sm disabled:opacity-60 inline-flex items-center gap-2';
    if (variant === 'primary') {
      return `${base} ${isLight ? 'bg-[#2f9d73] text-white border border-[#bde5d1] hover:bg-[#258660]' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`;
    }
    return `${base} ${isLight ? 'bg-[#3d82f6] text-white border border-[#c5d9ff] hover:bg-[#2f6ee5]' : 'bg-blue-600 hover:bg-blue-700 text-white'}`;
  };
  const pendingBadgeClass = isLight
    ? 'mb-3 text-xs inline-flex items-center gap-2 bg-[#fff4e0] text-[#8a6b44] border border-[#f2cfae] px-2 py-1 rounded'
    : 'mb-3 text-xs inline-flex items-center gap-2 bg-amber-600/20 text-amber-300 border border-amber-600/40 px-2 py-1 rounded';
  const summaryCardWrapper = isLight ? 'space-y-1 text-sm text-[#3c3127]' : 'space-y-1 text-sm';

  // Currently selected plan info (to read yearly discount, etc.).
  const selectedPlanInfo = useMemo(() => plans.find(p => p.code === selectedPlan), [plans, selectedPlan]);

  // Enforce dropdown order: فضي → ذهبي → ملكي (silver → golden → king)
  const sortedPlans = useMemo(() => {
    const order = ['silver','golden','king'];
    const rank = (c?: string) => {
      const i = order.indexOf(String(c||'').toLowerCase());
      return i === -1 ? 999 : i;
    };
    return [...plans].sort((a,b) => rank(a.code) - rank(b.code));
  }, [plans]);

  // Infer current subscription period (monthly/yearly) from duration between start and end
  const periodLabel = useMemo(() => {
    if (!sub?.start_at || !sub?.end_at) return '—';
    try {
      const start = new Date(sub.start_at).getTime();
      const end = new Date(sub.end_at).getTime();
      const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
      // Heuristic: >= 200 days ≈ yearly, otherwise monthly (given our 30 vs 360 days rule)
      return days >= 200 ? 'سنوي' : 'شهري';
    } catch {
      return '—';
    }
  }, [sub?.start_at, sub?.end_at]);

  const remainingDays = useMemo(() => {
    if (!sub || !sub.end_at) return 0;
    const end = new Date(sub.end_at);
    const now = new Date();
    const diff = Math.floor((end.getTime() - now.getTime()) / (1000*60*60*24));
    return Math.max(0, diff);
  }, [sub]);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiClient.getMySubscription();
      setSub(data.subscription || null);
      setPending(data.pending_request || null);
      const pl = await apiClient.getSubscriptionPlans();
      setPlans(pl);
      // default selected plan is current plan if any
      const code = data?.subscription?.plan?.code as PlanCode | undefined;
      if (code) setSelectedPlan(code);
    } catch (e:any) {
      setError(e?.message || 'تعذر تحميل البيانات');
    } finally { setLoading(false); }
  };
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
    if (!mounted) return;
    if (blocked) return;
    if (!apiClient.access) { setLoading(false); return; }
    load();
  }, [mounted, blocked]);

  const renew = async (period: 'monthly'|'yearly') => {
    setBusy(true);
    try {
      await apiClient.renewSubscription(selectedPlan, period);
      await load();
      alert('تم إنشاء طلب التجديد بنجاح، سيتم مراجعته');
    } catch (e:any) {
      alert(e?.message || 'تعذر إنشاء الطلب');
    } finally { setBusy(false); }
  };

  if (!mounted) {
    return (
      <div className={containerClass}>
        <div className={`${panelClass} text-center text-sm ${isLight ? 'text-[#8d7a69]' : 'text-gray-300'}`}>
          جارٍ التحقق من حالة الاشتراك…
        </div>
      </div>
    );
  }

  if (!apiClient.access || blocked) {
    return (
      <div className={`${containerClass} flex items-center justify-center`}>
        <div className={isLight ? 'bg-white/95 border border-[#f2cdaa] rounded-2xl p-6 max-w-md w-full text-center shadow-sm' : 'bg-chatPanel border border-chatDivider rounded-lg p-6 max-w-md w-full text-center'}>
          <div className={`font-bold mb-2 ${isLight ? 'text-[#3b2f24]' : ''}`}>{blocked ? 'هذه الصفحة متاحة فقط للمالك' : 'الرجاء تسجيل الدخول أولاً'}</div>
          <a href="/" className={isLight ? 'text-sm text-[#27825b] hover:underline' : 'text-sm text-green-400 hover:underline'}>الانتقال للصفحة الرئيسية</a>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className={panelClass}>
        <div className="flex items-center gap-3 mb-4">
          <Link href="/" className={backLinkClass} title="رجوع">
            <svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/>
            </svg>
          </Link>
          <h1 className={titleClass}>الاشتراك</h1>
        </div>

        {/* Plans snapshot table (top of page) */}
        <div className="mb-4">
          <div className={tableWrapperClass}>
            <div className={tableHeaderClass}>
              <div className="px-2 py-1.5 font-semibold">فضي</div>
              <div className="px-2 py-1.5 font-semibold">ذهبي</div>
              <div className="px-2 py-1.5 font-semibold">ملكي</div>
            </div>
            <div className={tableRowClass}>
              <div className="px-2 py-1.5">5 جهات اتصال</div>
              <div className="px-2 py-1.5">30 جهة اتصال</div>
              <div className="px-2 py-1.5">غير محدود</div>
            </div>
            <div className={tableRowLastClass}>
              <div className="px-2 py-1.5">20 دولار</div>
              <div className="px-2 py-1.5">30 دولار</div>
              <div className="px-2 py-1.5">50 دولار</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className={`text-sm ${isLight ? 'text-[#9a8878]' : 'text-gray-400'}`}>جارٍ التحميل…</div>
        ) : error ? (
          <div className={`text-sm ${isLight ? 'text-[#d1433f]' : 'text-red-400'}`}>{error}</div>
        ) : (
          <div className="space-y-3">
            <div className={metaCardClass}>
              {pending && (
                <div className={pendingBadgeClass}>
                  <span className={`h-2 w-2 rounded-full ${isLight ? 'bg-[#e6a23c]' : 'bg-amber-400'}`} />
                  <span>طلبك قيد المراجعة</span>
                </div>
              )}
              {/* Single-column layout on all screen sizes (match mobile design) */}
              <div className={summaryCardWrapper}>
                <div className="flex justify-between"><span className={metaLabelClass}>الباقة الحالية</span><span className="font-semibold">{planNameOrLabel(sub?.plan)}</span></div>
                <div className="flex justify-between"><span className={metaLabelClass}>نوع الاشتراك</span><span className="font-semibold">{periodLabel}</span></div>
                <div className="flex justify-between"><span className={metaLabelClass}>تاريخ آخر اشتراك</span><span>{formatDateTimeEn(sub?.start_at)}</span></div>
                <div className="flex justify-between"><span className={metaLabelClass}>تاريخ الانتهاء</span><span>{formatDateTimeEn(sub?.end_at)}</span></div>
                <div className="flex justify-between"><span className={metaLabelClass}>الحالة</span><span>{statusLabel(sub?.status)}</span></div>
                <div className="flex justify-between"><span className={metaLabelClass}>الأيام المتبقية</span><span>{remainingDays}</span></div>
              </div>
            </div>

            <div className={`${metaCardClass} space-y-3`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className={`text-sm ${isLight ? 'text-[#6f5b4a]' : 'text-gray-300'}`}>ترقية الباقة</div>
                <select disabled={!!pending || busy} value={selectedPlan} onChange={e=>setSelectedPlan(e.target.value as PlanCode)} className={selectClass}>
                  {sortedPlans.map(p => (
                    <option key={p.code} value={p.code}>{planNameOrLabel(p)}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={!!pending || busy} onClick={()=>renew('monthly')} className={buttonClass('primary')}>تجديد شهري</button>
                <button
                  disabled={!!pending || busy}
                  onClick={()=>renew('yearly')}
                  className={buttonClass('secondary')}
                >
                  <span>تجديد سنوي</span>
                  {!!selectedPlanInfo?.yearly_discount_percent && (
                    <span className={isLight ? 'px-2 py-0.5 rounded text-[10px] font-bold bg-[#fcd34d] text-[#854d0e] shadow-sm border border-[#f8c66c]' : 'px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-300 text-yellow-900 shadow-sm'}>
                      خصم {selectedPlanInfo.yearly_discount_percent} %
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
