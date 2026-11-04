import React, { useState } from 'react';
import { UserProfile, LLMConfig, AuthPolicy } from '../types';
import { X, Phone, ShieldCheck, AlertTriangle, LockKeyhole, Eye, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { DEFAULT_USER_AGREEMENT, DEFAULT_PRIVACY_POLICY } from '../data/initialData';
import { evaluatePasswordStrength, PasswordStrength } from '../lib/passwordStrength';
import { useI18n, serverMessage } from '../i18n';
import { apiFetch } from '../lib/apiFetch';

interface LoginModalProps {
  onSuccess: (user: UserProfile) => void;
  onClose: () => void;
  reason?: 'required' | 'quota';
  llmConfig?: LLMConfig;
  authPolicy?: AuthPolicy;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess, onClose, reason, llmConfig, authPolicy }) => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [step, setStep] = useState<'login' | 'register' | 'change_password'>('login');
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [viewingAgreement, setViewingAgreement] = useState<'terms' | 'privacy' | null>(null);
  const { t } = useI18n();
  const minLength = authPolicy?.userMinLength || 6;
  // 注册始终开放（2026-11-02 产品决策）；字段缺省时也按开放处理
  const registrationEnabled = authPolicy?.registrationEnabled !== false;
  const strength = evaluatePasswordStrength(newPassword, minLength);
  const registerStrength = evaluatePasswordStrength(regPassword, minLength);
  const userAgreementTitle = llmConfig?.agreements?.userAgreementTitle || t('login.defaultUserAgreementTitle');
  const userAgreementContent = llmConfig?.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT;
  const privacyPolicyTitle = llmConfig?.agreements?.privacyPolicyTitle || t('login.defaultPrivacyPolicyTitle');
  const privacyPolicyContent = llmConfig?.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY;

  const switchStep = (next: 'login' | 'register') => {
    setStep(next);
    setErrorMsg('');
  };

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{11}$/.test(phone.trim())) return setErrorMsg(t('login.errPhone'));
    if (!password) return setErrorMsg(t('login.errPasswordRequired'));
    if (!agreed) return setErrorMsg(t('login.errAgreement'));
    setIsSubmitting(true); setErrorMsg('');
    try {
      const response = await apiFetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setErrorMsg(serverMessage(data, t, 'login.errLoginFailed'));
      if (data.passwordChangeRequired) { setStep('change_password'); return; }
      if (data.user) onSuccess(data.user);
    } catch { setErrorMsg(t('login.errNetwork')); }
    finally { setIsSubmitting(false); }
  };

  const submitRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{11}$/.test(phone.trim())) return setErrorMsg(t('login.errPhone'));
    if (regPassword.length < minLength) return setErrorMsg(t('login.errPasswordTooShort', { min: minLength }));
    if (regPassword !== regConfirmPassword) return setErrorMsg(t('login.errPasswordMismatch'));
    if (!agreed) return setErrorMsg(t('login.errAgreement'));
    setIsSubmitting(true); setErrorMsg('');
    try {
      const response = await apiFetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), password: regPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setErrorMsg(serverMessage(data, t, 'login.errRegisterFailed'));
      // 注册接口直接签发会话，成功后与登录一致进入平台
      if (data.user) onSuccess(data.user);
    } catch { setErrorMsg(t('login.errNetwork')); }
    finally { setIsSubmitting(false); }
  };

  const submitPasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < minLength) return setErrorMsg(t('login.errPasswordTooShort', { min: minLength }));
    if (newPassword !== confirmPassword) return setErrorMsg(t('login.errPasswordMismatch'));
    setIsSubmitting(true); setErrorMsg('');
    try {
      const response = await apiFetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: password, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setErrorMsg(serverMessage(data, t, 'login.errChangePasswordFailed'));
      if (data.user) onSuccess(data.user);
    } catch { setErrorMsg(t('login.errNetwork')); }
    finally { setIsSubmitting(false); }
  };

  const titleKey = step === 'login' ? 'login.titleLogin' : step === 'register' ? 'login.titleRegister' : 'login.titleChangePassword';

  // 手机号输入框与协议勾选在登录 / 注册两个表单间复用
  const phoneField = (
    <>
      <label className="block text-[11px] font-medium text-gray-500">{t('login.phoneLabel')}</label>
      <div className="relative">
        <Phone className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="username" className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" placeholder={t('login.phonePlaceholder')} />
      </div>
    </>
  );

  const agreementField = (
    <label className="flex items-start gap-2 text-[11px] text-gray-500 leading-relaxed">
      <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
      <span>
        {t('login.agreementPrefix')}{' '}
        <button type="button" className="text-amber-800 underline" onClick={() => setViewingAgreement('terms')}>{userAgreementTitle}</button>{' '}
        {t('login.agreementAnd')}{' '}
        <button type="button" className="text-amber-800 underline" onClick={() => setViewingAgreement('privacy')}>{privacyPolicyTitle}</button>
      </span>
    </label>
  );

  const renderStrength = (value: PasswordStrength | null) => value ? (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${value.barClass} transition-all`} style={{ width: `${value.widthPercent}%` }} />
        </div>
        <span className={`text-[10px] font-bold shrink-0 ${value.textClass}`}>{t('password.strengthLabel', { level: t(value.labelKey) })}</span>
      </div>
      <p className={`text-[10px] leading-relaxed ${value.textClass}`}>{t(value.hintKey, value.hintVars)}</p>
    </div>
  ) : null;

  const switchLinkClass = 'w-full text-center text-[11px] text-amber-800 hover:text-amber-900 underline underline-offset-2 cursor-pointer';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col antialiased text-left transition-all">
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <span className="font-bold text-sm text-gray-900 tracking-tight">{t(titleKey)}</span>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900 rounded-lg transition-colors cursor-pointer" aria-label={t('common.close')}><X className="w-4 h-4" /></button>
        </div>
        {((reason && step === 'login') || step === 'change_password') && (
          <div className="px-5 pt-3.5 -mb-1">
            <p className="text-xs text-gray-500 leading-relaxed flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>{step === 'change_password' ? t('login.noticeChangePassword', { min: minLength }) : reason === 'quota' ? t('login.noticeQuota') : t('login.noticeLoginRequired')}</span>
            </p>
          </div>
        )}
        <div className="p-5 space-y-3.5">
          {step === 'login' ? (
            <form onSubmit={submitLogin} className="space-y-3">
              {phoneField}
              <label className="block text-[11px] font-medium text-gray-500">{t('login.passwordLabel')}</label>
              <div className="relative"><LockKeyhole className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" placeholder={t('login.passwordPlaceholder')} /></div>
              {agreementField}
              {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
              <button disabled={isSubmitting} className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:opacity-50">{isSubmitting ? t('login.submitLoggingIn') : t('login.submitLogin')}</button>
              {/* 无短信找回能力，忘记密码统一引导联系管理员 */}
              <p className="text-center text-[11px] text-gray-400 leading-relaxed">{t('login.forgotPasswordHint')}</p>
              {registrationEnabled && (
                <button type="button" onClick={() => switchStep('register')} className={switchLinkClass}>{t('login.switchToRegister')}</button>
              )}
            </form>
          ) : step === 'register' ? (
            <form onSubmit={submitRegister} className="space-y-3">
              {phoneField}
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-medium text-gray-500">{t('login.registerPasswordLabel', { min: minLength })}</label>
                <button
                  type="button"
                  onClick={() => setShowRegPassword((v) => !v)}
                  aria-pressed={showRegPassword}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
                >
                  {showRegPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showRegPassword ? t('login.hidePassword') : t('login.showPassword')}
                </button>
              </div>
              <input type={showRegPassword ? 'text' : 'password'} value={regPassword} onChange={(e) => setRegPassword(e.target.value)} autoComplete="new-password" className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
              {renderStrength(registerStrength)}
              <label className="block text-[11px] font-medium text-gray-500">{t('login.confirmPasswordLabel')}</label>
              <input type={showRegPassword ? 'text' : 'password'} value={regConfirmPassword} onChange={(e) => setRegConfirmPassword(e.target.value)} autoComplete="new-password" className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
              {agreementField}
              {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
              <button disabled={isSubmitting} className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:opacity-50">{isSubmitting ? t('login.registerSubmitting') : t('login.registerSubmit')}</button>
              <button type="button" onClick={() => switchStep('login')} className={switchLinkClass}>{t('login.switchToLogin')}</button>
            </form>
          ) : (
            <form onSubmit={submitPasswordChange} className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 rounded-lg p-3"><ShieldCheck className="w-4 h-4" />{t('login.changeSuccess')}</div>
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-medium text-gray-500">{t('login.newPasswordLabel', { min: minLength })}</label>
                {/* 首登改密要连输两遍，看不清时很容易输错；这个按钮同时切换两个框的可见性 */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showPassword ? t('login.hidePassword') : t('login.showPassword')}
                </button>
              </div>
              <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
              {renderStrength(strength)}
              <label className="block text-[11px] font-medium text-gray-500">{t('login.confirmPasswordLabel')}</label>
              <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
              {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
              <button disabled={isSubmitting} className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:opacity-50">{isSubmitting ? t('login.submitSaving') : t('login.submitChange')}</button>
            </form>
          )}
        </div>
        {viewingAgreement && (
          <div className="absolute inset-0 bg-white z-10 p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-4"><b className="text-sm">{viewingAgreement === 'terms' ? userAgreementTitle : privacyPolicyTitle}</b><button onClick={() => setViewingAgreement(null)} className="text-xs text-gray-500">{t('login.back')}</button></div>
            <div className="prose prose-sm max-w-none text-xs text-gray-600"><ReactMarkdown>{viewingAgreement === 'terms' ? userAgreementContent : privacyPolicyContent}</ReactMarkdown></div>
          </div>
        )}
      </div>
    </div>
  );
};
