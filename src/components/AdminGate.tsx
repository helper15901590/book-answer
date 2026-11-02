import React, { useEffect, useState } from 'react';
import { UserProfile, Skill, LLMConfig } from '../types';
import { DEFAULT_LLM_CONFIG } from '../data/initialData';
import { AdminPanel } from './AdminPanel';
import { apiFetch, tryLogout } from '../lib/apiFetch';

export const AdminGate: React.FC = () => {
  const [admin, setAdmin] = useState<UserProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    apiFetch('/api/admin/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data?.user) setAdmin(data.user); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  // 管理员账号来自环境变量，登录仅校验手机号 + 密码。
  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      const response = await apiFetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.message || '登录失败');
      if (data.user) setAdmin(data.user);
    } catch { setError('网络请求异常，请稍后重试'); }
    finally { setSubmitting(false); }
  };

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">正在验证身份…</div>;
  if (!admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-gray-200 p-6">
          <h1 className="font-bold text-base text-gray-900 mb-4">管理后台登录</h1>
          <form onSubmit={handleLogin} className="space-y-3">
            <label className="block text-[11px] font-medium text-gray-500">管理员手机号</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" autoComplete="username" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900" placeholder="11 位手机号" />
            <label className="block text-[11px] font-medium text-gray-500">管理员密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900" placeholder="至少 16 位强密码" />
            {error && <p className="text-xs text-rose-500">{error}</p>}
            <button disabled={submitting} className="w-full py-2 bg-gray-900 text-white text-xs font-medium rounded-xl disabled:opacity-50">{submitting ? '登录中…' : '登录'}</button>
          </form>
        </div>
      </div>
    );
  }

  // 退出后台。没真的登出就不能跳转：管理员会话 Cookie 有 8 小时有效期，
  // 直接跳转会让管理员以为已经退出，把仍然可用的后台留在浏览器上。
  const handleAdminClose = async () => {
    if (!(await tryLogout('/api/admin/logout'))) {
      alert('退出登录失败，当前会话可能仍然有效。请重试；若反复失败，请清除本站点的 Cookie。');
      return;
    }
    // BASE_URL 恒以 / 结尾（vite base 约定），直接作为站点内首页地址使用
    window.location.href = import.meta.env.BASE_URL;
  };

  return <AdminPanel llmConfig={llmConfig} setLlmConfig={setLlmConfig} skills={skills} setSkills={setSkills} user={admin} setUser={setAdmin} onClose={handleAdminClose} />;
};
