import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { requiresStaffLogin, setSessionAccessToken } from '../authSession';

export default function StaffAccessGate({ children }: React.PropsWithChildren) {
  const [status, setStatus] = useState<'loading' | 'login' | 'allowed' | 'denied'>(requiresStaffLogin ? 'loading' : 'allowed');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!requiresStaffLogin) return;
    if (!supabase) { setError('Подключение к серверу не настроено.'); setStatus('login'); return; }
    let active = true;
    let generation = 0;
    const verify = async (token: string | null) => {
      const revision = ++generation;
      setSessionAccessToken(token);
      if (!token) { if (active) setStatus('login'); return; }
      if (active) setStatus('loading');
      const { data, error: failure } = await supabase!.rpc('app_is_member');
      if (active && generation === revision) {
        setStatus(!failure && data === true ? 'allowed' : 'denied');
        if (failure) setError('Не удалось проверить доступ. Проверьте соединение с сервером.');
      }
    };
    void supabase.auth.getSession().then(({ data, error: failure }) => {
      if (failure && active) setError('Не удалось восстановить сеанс. Войдите снова.');
      if (active) void verify(data.session?.access_token || null);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase callbacks must complete before another auth-dependent request starts.
      queueMicrotask(() => { if (active) void verify(session?.access_token || null); });
    });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, []);
  if (status === 'allowed') return <>{requiresStaffLogin && <button type="button"
    onClick={() => { void supabase?.auth.signOut(); }}
    className="fixed right-3 top-2 z-[95] rounded-lg border bg-white/95 px-3 py-2 text-xs text-slate-600">Выйти</button>}{children}</>;
  if (status === 'loading') return <main role="status" className="grid min-h-[100dvh] place-items-center text-slate-600">Проверяем доступ…</main>;
  return <main className="grid min-h-[100dvh] place-items-center bg-slate-50 p-5">
    <form className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-lg" onSubmit={async (event) => {
      event.preventDefault(); if (!supabase || busy) return;
      setBusy(true); setError('');
      try {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) setError('Не удалось войти. Проверьте email, пароль и соединение.');
      } catch { setError('Сервер недоступен. Попробуйте ещё раз.'); }
      finally { setBusy(false); }
    }}>
      <h1 className="text-xl font-bold">Вход для сотрудников</h1>
      {status === 'denied' ? <>
        <p role="alert" className="mt-4 text-sm">У этой учётной записи нет доступа. Администратор должен добавить её в список сотрудников.</p>
        <button type="button" onClick={() => { void supabase?.auth.signOut(); }} className="mt-4 rounded-xl border px-4 py-3">Войти с другой учётной записью</button>
      </> : <>
        <label className="mt-5 block text-sm">Email<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>
        <label className="mt-4 block text-sm">Пароль<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>
        <button type="submit" disabled={busy || !supabase} className="mt-5 w-full rounded-xl bg-blue-600 p-3 font-semibold text-white disabled:opacity-50">{busy ? 'Входим…' : 'Войти'}</button>
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </form>
  </main>;
}
