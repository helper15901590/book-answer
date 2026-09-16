import React, { useState } from 'react';
import { UserProfile, LLMConfig, AuthPolicy } from '../types';
import { X, Phone, ShieldCheck, AlertTriangle, LockKeyhole } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { DEFAULT_USER_AGREEMENT, DEFAULT_PRIVACY_POLICY } from '../data/initialData';
import { evaluatePasswordStrength } from '../lib/passwordStrength';
import { useI18n, serverMessage } from '../i18n';

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
  const [step, setStep] = useState<'login' | 'change_password'>('login');
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [viewingAgreement, setViewingAgreement] = useState<'terms' | 'privacy' | null>(null);
  const { t } = useI18n();
  const minLength = authPolicy?.userMinLength || 6;
  const strength = evaluatePasswordStrength(newPassword, minLength);
  const userAgreementTitle = llmConfig?.agreements?.userAgreementTitle || t('login.defaultUserAgreementTitle');
  const userAgreementContent = llmConfig?.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT;
  const privacyPolicyTitle = llmConfig?.agreements?.privacyPolicyTitle || t('login.defaultPrivacyPolicyTitle');
  const privacyPolicyContent = llmConfig?.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY;

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{11}$/.test(phone.trim())) return setErrorMsg(t('login.errPhone'));
    if (!password) return setErrorMsg(t('login.errPasswordRequired'));
    if (!agreed) return setErrorMsg(t('login.errAgreement'));
    setIsSubmitting(true); setErrorMsg('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setErrorMsg(serverMessage(data, t, 'login.errLoginFailed'));
      if (data.passwordChangeRequired) { setStep('change_password'); return; }
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
      const response = await fetch('/api/auth/change-password', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: password, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setErrorMsg(serverMessage(data, t, 'login.errChangePasswordFailed'));
      if (data.user) onSuccess(data.user);
    } catch { setErrorMsg(t('login.errNetwork')); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col antialiased text-left transition-all">
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <span className="font-bold text-sm text-gray-900 tracking-tight">{t(step === 'login' ? 'login.titleLogin' : 'login.titleChangePassword')}</span>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900 rounded-lg transition-colors cursor-pointer" aria-label={t('common.close')}><X className="w-4 h-4" /></button>
        </div>
        {(reason || step === 'change_password') && (
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
              <label className="block text-[11px] font-medium text-gray-500">{t('login.phoneLabel')}</label>
              <div className="relative"><Phone className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" /><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="username" className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" placeholder={t('login.phonePlaceholder')} /></div>
              <label className="block text-[11px] font-medium text-gray-500">{t('login.passwordLabel')}</label>
              <div className="relative"><LockKeyhole className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" placeholder={t('login.passwordPlaceholder')} /></div>
              <label className="flex items-start gap-2 text-[11px] text-gray-500 leading-relaxed"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" /><span>{t('login.agreementPrefix')} <button type="button" className="text-amber-800 underline" onClick={() => setViewingAgreement('terms')}>{userAgreementTitle}</button> {t('login.agreementAnd')} <button type="button" className="text-amber-800 underline" onClick={() => setViewingAgreement('privacy')}>{privacyPolicyTitle}</button></span></label>
              {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
              <button disabled={isSubmitting} className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:opacity-50">{isSubmitting ? t('login.submitLoggingIn') : t('login.submitLogin')}</button>
            </form>
          ) : (
            <form onSubmit={submitPasswordChange} className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 rounded-lg p-3"><ShieldCheck className="w-4 h-4" />{t('login.changeSuccess')}</div>
              <label className="block text-[11px] font-medium text-gray-500">{t('login.newPasswordLabel', { min: minLength })}</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
              {strength && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${strength.barClass} transition-all`} style={{ width: `${strength.widthPercent}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold shrink-0 ${strength.textClass}`}>{t('password.strengthLabel', { level: t(strength.labelKey) })}</span>
                  </div>
                  <p className={`text-[10px] leading-relaxed ${strength.textClass}`}>{t(strength.hintKey, strength.hintVars)}</p>
                </div>
              )}
              <label className="block text-[11px] font-medium text-gray-500">{t('login.confirmPasswordLabel')}</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
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