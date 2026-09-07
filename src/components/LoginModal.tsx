import React, { useState } from 'react';
import { UserProfile, LLMConfig } from '../types';
import { X, Phone, ShieldCheck, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { DEFAULT_USER_AGREEMENT, DEFAULT_PRIVACY_POLICY } from '../data/initialData';

interface LoginModalProps {
  onSuccess: (user: UserProfile) => void;
  onClose: () => void;
  isTriggeredBy401?: boolean;
  llmConfig?: LLMConfig;
  initialMode?: 'login' | 'register';
}

export const LoginModal: React.FC<LoginModalProps> = ({
  onSuccess,
  onClose,
  isTriggeredBy401,
  llmConfig,
}) => {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [viewingAgreement, setViewingAgreement] = useState<'terms' | 'privacy' | null>(null);

  const userAgreementTitle = llmConfig?.agreements?.userAgreementTitle || '用户服务协议';
  const userAgreementContent = llmConfig?.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT;
  const privacyPolicyTitle = llmConfig?.agreements?.privacyPolicyTitle || '隐私政策';
  const privacyPolicyContent = llmConfig?.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY;
  const guestQuota = llmConfig?.dailyLimits?.guestUser ?? 3;

  // Handle Send Code Countdown
  const handleSendCode = () => {
    if (!phone.trim()) {
      setErrorMsg('请输入手机号码');
      return;
    }
    if (!/^\d{11}$/.test(phone)) {
      setErrorMsg('手机号码必须为11位阿拉伯数字');
      return;
    }
    setErrorMsg('');
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setErrorMsg('请输入手机号码');
      return;
    }
    if (!/^\d{11}$/.test(phone)) {
      setErrorMsg('手机号码必须为11位阿拉伯数字');
      return;
    }

    if (!code.trim()) {
      setErrorMsg('请输入短信验证码');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setErrorMsg('验证码必须为6位阿拉伯数字');
      return;
    }

    if (!agreed) {
      setErrorMsg('请先勾选同意用户协议与隐私政策');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(),
          code: code.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || '登录失败，请检查账号或验证码');
        setIsSubmitting(false);
        return;
      }

      if (data.token) {
        localStorage.setItem('auth_token', data.token);
      }
      if (data.user) {
        onSuccess(data.user);
      }
    } catch (e: any) {
      console.error('Auth request error:', e);
      setErrorMsg('网络请求异常，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col antialiased text-left transition-all">
        {/* Header */}
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <span className="font-bold text-sm text-gray-900 tracking-tight">账号登录</span>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-900 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notice Prompt when triggered by quota exhaustion */}
        {isTriggeredBy401 && (
          <div className="px-5 pt-3.5 -mb-1">
            <p className="text-xs text-gray-500 leading-relaxed font-normal flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 inline-block" />
              <span>{`您当前还未登录，享有的体验额度${guestQuota}次已用完，请登录后继续体验。`}</span>
            </p>
          </div>
        )}

        {/* Body */}
        <div className="p-5 space-y-3.5">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Phone Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-500">手机号码</label>
              <div className="relative flex items-center">
                <Phone className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={11}
                  value={phone}
                  onChange={(e) => {
                    const filtered = e.target.value.replace(/\D/g, '').slice(0, 11);
                    setPhone(filtered);
                    if (errorMsg) setErrorMsg('');
                  }}
                  placeholder="请输入11位手机号"
                  className="w-full pl-9 pr-3 py-2 bg-transparent border border-gray-200 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 focus:bg-transparent transition-all"
                />
              </div>
            </div>

            {/* Code Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-500">短信验证码</label>
              <div className="flex gap-2">
                <div className="relative flex-1 flex items-center">
                  <ShieldCheck className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      const filtered = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setCode(filtered);
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder="6位阿拉伯数字验证码"
                    className="w-full pl-9 pr-3 py-2 bg-transparent border border-gray-200 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 focus:bg-transparent transition-all"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={countdown > 0}
                  className="px-3 py-2 bg-transparent hover:bg-gray-50 disabled:bg-transparent text-gray-700 disabled:text-gray-400 rounded-xl text-xs font-medium border border-gray-200 transition-all shrink-0 cursor-pointer disabled:cursor-not-allowed"
                >
                  {countdown > 0 ? `${countdown}s` : '获取验证码'}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-600 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 bg-[#f4efe6] hover:bg-[#eae2d5] text-[#2c221e] text-xs font-bold rounded-xl border border-[#e2dacd] transition-all flex items-center justify-center shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <span>{isSubmitting ? '登录中...' : '确认登录'}</span>
            </button>
          </form>

          {/* Agreement Footer */}
          <div className="pt-3 border-t border-gray-100 flex items-start gap-1.5 text-[10px] text-gray-500">
            <input
              type="checkbox"
              id="agreement"
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked);
                if (errorMsg) setErrorMsg('');
              }}
              className="mt-0.5 rounded border-gray-300 accent-[#cbb88b] text-[#cbb88b] focus:ring-0 cursor-pointer"
            />
            <label htmlFor="agreement" className="cursor-pointer leading-tight select-none">
              已阅读并同意
              <button
                type="button"
                onClick={() => setViewingAgreement('terms')}
                className="text-[#8c6227] hover:underline mx-0.5 cursor-pointer font-medium"
              >
                《{userAgreementTitle}》
              </button>
              和
              <button
                type="button"
                onClick={() => setViewingAgreement('privacy')}
                className="text-[#8c6227] hover:underline mx-0.5 cursor-pointer font-medium"
              >
                《{privacyPolicyTitle}》
              </button>
            </label>
          </div>
        </div>
      </div>

      {/* Agreement View Modal */}
      {viewingAgreement && (
        <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg max-h-[80vh] rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 bg-gray-200/70 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setViewingAgreement('terms')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewingAgreement === 'terms'
                      ? 'bg-white text-gray-900 shadow-2xs'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {userAgreementTitle}
                </button>
                <button
                  type="button"
                  onClick={() => setViewingAgreement('privacy')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewingAgreement === 'privacy'
                      ? 'bg-white text-gray-900 shadow-2xs'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {privacyPolicyTitle}
                </button>
              </div>
              <button
                onClick={() => setViewingAgreement(null)}
                className="p-1 text-gray-400 hover:text-gray-900 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto text-xs text-gray-700 leading-relaxed font-sans prose prose-xs max-w-none">
              <div className="markdown-body">
                <ReactMarkdown>
                  {viewingAgreement === 'terms' ? userAgreementContent : privacyPolicyContent}
                </ReactMarkdown>
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end shrink-0">
              <button
                onClick={() => {
                  setAgreed(true);
                  setViewingAgreement(null);
                }}
                className="px-4 py-2 bg-[#f4efe6] hover:bg-[#eae2d5] text-[#2c221e] text-xs font-bold rounded-xl border border-[#e2dacd] transition-all cursor-pointer shadow-2xs"
              >
                同意并返回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
