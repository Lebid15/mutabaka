'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../../lib/api';
import { useThemeMode } from '../theme-context';

type PolicyPayload = {
  id: number;
  title: string;
  content: string;
  updated_at: string;
};

const formatDate = (iso?: string) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
};

export default function PolicyPage() {
  const { isLight, toggleTheme } = useThemeMode();
  const [policy, setPolicy] = useState<PolicyPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await apiClient.getPrivacyPolicy();
        if (!cancelled) {
          setPolicy(payload);
        }
      } catch {
        if (!cancelled) {
          setPolicy(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bgClass = isLight
    ? 'bg-gradient-to-br from-white via-orange-50 to-orange-100 text-gray-900'
    : 'bg-chatBg text-gray-100';
  const cardClass = isLight
    ? 'bg-white/85 border border-orange-100/80 shadow-xl'
    : 'bg-chatPanel border border-chatDivider shadow-2xl/40';
  const title = policy?.title?.trim() || 'سياسة الخصوصية';
  const updatedAt = formatDate(policy?.updated_at);

  const contentHtml = policy?.content
    ? policy.content
    : '<p>لم يتم إعداد سياسة الخصوصية بعد. يرجى التواصل مع المسؤول.</p>';

  return (
    <div className={`min-h-screen ${bgClass} transition-colors duration-500`}> 
      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-10 md:px-10">
        <button
          type="button"
          onClick={toggleTheme}
          className={`absolute top-6 right-6 grid h-11 w-11 place-items-center rounded-full border ${isLight ? 'border-orange-200/70 bg-white/80 text-orange-400 hover:text-orange-500' : 'border-chatDivider bg-chatPanel text-yellow-300 hover:text-yellow-200'} transition`}
          aria-label={isLight ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
        >
          {isLight ? '🌙' : '☀️'}
        </button>
        <header className="mt-10 flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          {updatedAt && (
            <p className="text-sm text-gray-400">تم التحديث: {updatedAt}</p>
          )}
        </header>
        <main
          className={`flex-1 overflow-hidden rounded-3xl p-8 text-right leading-7 ${cardClass}`}
          dir="rtl"
        >
          {loading ? (
            <p className="text-sm text-gray-400">جاري تحميل سياسة الخصوصية...</p>
          ) : (
            <article
              className="prose prose-invert max-w-none prose-headings:text-current prose-p:leading-loose"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          )}
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-4 text-sm text-gray-400">
          <Link href="/" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
            ← العودة لصفحة تسجيل الدخول
          </Link>
          <span>© {new Date().getFullYear()} Mutabaka</span>
        </footer>
      </div>
    </div>
  );
}
