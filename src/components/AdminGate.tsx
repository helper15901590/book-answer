import React, { useEffect, useState } from 'react';
import { UserProfile, Skill, LLMConfig } from '../types';
import { DEFAULT_LLM_CONFIG } from '../data/initialData';
import { AdminPanel } from './AdminPanel';
import { authHeaders, authTokenKey } from '../lib/apiFetch';

// 管理后台独立入口：先验证管理员身份，再渲染原封不动的 AdminPanel
export const AdminGate: React.FC = () => {
  const [admin, setAdmin] = useState<UserProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [skills, setSkills] = useState<Skill[]>([]);

  // 已持有有效管理员 token 则直接进入
  useEffect(() => {
    fetch('/api/auth/me', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.user && (data.user.role === 'admin' || data.user.isAdmin)) setAdmin(data.user);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || '登录失败');
        return;
      }
      if (data.user?.role !== 'admin' && !data.user?.isAdmin) {
        setError('该账号非管理员，禁止访问后台');
        return;
      }
      if (data.token) localStorage.setItem(authTokenKey(), data.token);
      setAdmin(data.user);
    } catch {
      setError('网络请求异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        正在验证身份…
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 p-6">
          <h1 className="font-bold text-base text-gray-900 mb-4">管理后台登录</h1>
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">管理员手机号</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={11}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="请输入11位手机号"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">密码 / 验证码</label>
              <input
                type="password"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6位数字"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900"
              />
            </div>
            {error && <p className="text-xs text-rose-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 bg-gray-900 text-white text-xs font-medium rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {submitting ? '登录中…' : '登录'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AdminPanel
      llmConfig={llmConfig}
      setLlmConfig={setLlmConfig}
      skills={skills}
      setSkills={setSkills}
      user={admin}
      setUser={setAdmin}
      onClose={() => {
        window.location.href = '/';
      }}
    />
  );
};
