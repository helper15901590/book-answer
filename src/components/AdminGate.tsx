import React, { useEffect, useState } from 'react';
import { UserProfile, Skill, LLMConfig } from '../types';
import { DEFAULT_LLM_CONFIG } from '../data/initialData';
import { AdminPanel } from './AdminPanel';

type LoginStep = 'credentials' | 'mfa_setup' | 'mfa_verify';

export const AdminGate: React.FC = () => {
  const [admin, setAdmin] = useState<UserProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUri: string; recoveryCodes: string[] } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    fetch('/api/admin/me', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data?.user) setAdmin(data.user); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.message || '登录失败');
      if (data.mfaSetupRequired) {
        const setupResponse = await fetch('/api/admin/mfa/setup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        const setup = await setupResponse.json().catch(() => ({}));
        if (!setupResponse.ok) return setError(setup.message || 'MFA 初始化失败');
        setSetupData(setup); setStep('mfa_setup'); return;
      }
      if (data.mfaRequired) { setStep('mfa_verify'); return; }
      if (data.user) setAdmin(data.user);
    } catch { setError('网络请求异常，请稍后重试'); }
    finally { setSubmitting(false); }
  };

  const handleSetupConfirm = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      const response = await fetch('/api/admin/mfa/confirm', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: otp.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.message || '动态验证码错误');
      setAdmin(data.user);
    } catch { setError('网络请求异常，请稍后重试'); }
    finally { setSubmitting(false); }
  };

  const handleMfaVerify = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      const response = await fetch('/api/admin/mfa/verify', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: otp.trim(), recoveryCode: recoveryCode.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.message || 'MFA 验证失败');
      setAdmin(data.user);
    } catch { setError('网络请求异常，请稍后重试'); }
    finally { setSubmitting(false); }
  };

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">正在验证身份…</div>;
  if (!admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-gray-200 p-6">
          <h1 className="font-bold text-base text-gray-900 mb-4">管理后台登录</h1>
          {step === 'credentials' && (
            <form onSubmit={handleLogin} className="space-y-3">
              <label className="block text-[11px] font-medium text-gray-500">管理员手机号</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" autoComplete="username" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900" placeholder="11 位手机号" />
              <label className="block text-[11px] font-medium text-gray-500">管理员密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900" placeholder="至少 16 位强密码" />
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <button disabled={submitting} className="w-full py-2 bg-gray-900 text-white text-xs font-medium rounded-xl disabled:opacity-50">{submitting ? '登录中…' : '下一步'}</button>
            </form>
          )}
          {step === 'mfa_setup' && setupData && (
            <form onSubmit={handleSetupConfirm} className="space-y-3">
              <p className="text-xs text-gray-600 leading-relaxed">首次登录需绑定 TOTP。请在认证器中添加以下密钥：</p>
              <code className="block break-all bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">{setupData.secret}</code>
              <p className="text-[11px] text-gray-400 break-all">{setupData.otpauthUri}</p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">恢复码仅显示一次</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-[11px] text-amber-900">{setupData.recoveryCodes.map((code) => <span key={code}>{code}</span>)}</div>
              </div>
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs text-center tracking-[0.4em] focus:outline-none focus:border-gray-900" placeholder="000000" />
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <button disabled={submitting} className="w-full py-2 bg-gray-900 text-white text-xs font-medium rounded-xl disabled:opacity-50">确认绑定并登录</button>
            </form>
          )}
          {step === 'mfa_verify' && (
            <form onSubmit={handleMfaVerify} className="space-y-3">
              <p className="text-xs text-gray-600">输入认证器动态验证码，或使用一次性恢复码。</p>
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs text-center tracking-[0.4em] focus:outline-none focus:border-gray-900" placeholder="000000" />
              <input value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-gray-900" placeholder="或输入恢复码" />
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <button disabled={submitting} className="w-full py-2 bg-gray-900 text-white text-xs font-medium rounded-xl disabled:opacity-50">登录后台</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return <AdminPanel llmConfig={llmConfig} setLlmConfig={setLlmConfig} skills={skills} setSkills={setSkills} user={admin} setUser={setAdmin} onClose={() => { window.location.href = '/'; }} />;
};