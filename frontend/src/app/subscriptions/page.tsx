"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';

type PlanCode = 'silver'|'golden'|'king';

// Render status with Arabic labels; "active" shown as green "نشط"
const statusLabel = (s?: string) => {
  if (!s) return <span className="text-gray-300">غير معروف</span>;
  if (s === 'active') return <span className="text-green-400 font-semibold">نشط</span>;
  if (s === 'expired') return <span className="text-red-400">منتهي</span>;
  if (s === 'cancelled') return <span className="text-gray-400">ملغي</span>;
  return <span className="text-gray-300">{s}</span>;
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [sub, setSub] = useState<any|null>(null);
  const [pending, setPending] = useState<any|null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>('silver');
  const [busy, setBusy] = useState(false);

  // Currently selected plan info (to read yearly discount, etc.)
  const selectedPlanInfo = useMemo(() => plans.find(p => p.code === selectedPlan), [plans, selectedPlan]);

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

  useEffect(() => { load(); }, []);

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

  return (
    <div className="min-h-screen bg-chatBg text-gray-100 p-4">
      <div className="max-w-2xl mx-auto bg-chatPanel border border-chatDivider rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/" className="text-gray-300 hover:text-white" title="رجوع">
            <svg xmlns='http://www.w3.org/2000/svg' className='h-6 w-6' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7'/>
            </svg>
          </Link>
          <h1 className="font-bold text-lg">الاشتراك</h1>
        </div>

        {/* Plans snapshot table (top of page) */}
        <div className="mb-4">
          <div className="rounded-lg overflow-hidden border border-chatDivider bg-[#0e1b22]/70 backdrop-blur-sm">
            {/* Row 1: plan names */}
            <div className="grid grid-cols-3 text-center bg-white/10 border-b border-chatDivider text-[13px]">
              <div className="px-2 py-1.5 font-semibold">فضي</div>
              <div className="px-2 py-1.5 font-semibold">ذهبي</div>
              <div className="px-2 py-1.5 font-semibold">ملكي</div>
            </div>
            {/* Row 2: contacts */}
            <div className="grid grid-cols-3 text-center border-b border-chatDivider text-xs divide-x divide-chatDivider/60">
              <div className="px-2 py-1.5">5 جهات اتصال</div>
              <div className="px-2 py-1.5">30 جهة اتصال</div>
              <div className="px-2 py-1.5">غير محدود</div>
            </div>
            {/* Row 3: price */}
            <div className="grid grid-cols-3 text-center text-xs divide-x divide-chatDivider/60">
              <div className="px-2 py-1.5">20 دولار</div>
              <div className="px-2 py-1.5">30 دولار</div>
              <div className="px-2 py-1.5">50 دولار</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">جارٍ التحميل…</div>
        ) : error ? (
          <div className="text-sm text-red-400">{error}</div>
        ) : (
          <div className="space-y-3">
            <div className="p-3 rounded border border-chatDivider">
              {pending && (
                <div className="mb-3 text-xs inline-flex items-center gap-2 bg-amber-600/20 text-amber-300 border border-amber-600/40 px-2 py-1 rounded">
                  <span className="h-2 w-2 bg-amber-400 rounded-full" />
                  طلبك قيد المراجعة
                </div>
              )}
              {/* Single-column layout on all screen sizes (match mobile design) */}
              <div className="grid grid-cols-1 gap-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">الباقة الحالية</span><span className="font-semibold">{sub?.plan?.code || '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">نوع الاشتراك</span><span className="font-semibold">{periodLabel}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">تاريخ آخر اشتراك</span><span>{formatDateTimeEn(sub?.start_at)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">تاريخ الانتهاء</span><span>{formatDateTimeEn(sub?.end_at)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">الحالة</span><span>{statusLabel(sub?.status)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">الأيام المتبقية</span><span>{remainingDays}</span></div>
              </div>
            </div>

            <div className="p-3 rounded border border-chatDivider space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-sm text-gray-300">ترقية الباقة</div>
                <select disabled={!!pending || busy} value={selectedPlan} onChange={e=>setSelectedPlan(e.target.value as PlanCode)} className="bg-chatBg border border-chatDivider rounded px-2 py-1 text-sm">
                  {plans.map(p => (
                    <option key={p.code} value={p.code}>{p.name || p.code}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={!!pending || busy} onClick={()=>renew('monthly')} className={(!!pending||busy? 'bg-emerald-600/60':'bg-emerald-600 hover:bg-emerald-700')+" px-3 py-1 rounded text-sm"}>تجديد شهري</button>
                <button
                  disabled={!!pending || busy}
                  onClick={()=>renew('yearly')}
                  className={(!!pending||busy? 'bg-blue-600/60':'bg-blue-600 hover:bg-blue-700')+" px-3 py-1 rounded text-sm inline-flex items-center gap-2"}
                >
                  <span>تجديد سنوي</span>
                  {!!selectedPlanInfo?.yearly_discount_percent && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-300 text-yellow-900 shadow-sm">
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
