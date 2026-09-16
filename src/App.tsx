import React, { useState } from 'react';
import { UserProfile, Skill, LLMConfig, AuthPolicy } from './types';
import { DEFAULT_LLM_CONFIG } from './data/initialData';
import { AiStudioWorkspace } from './components/AiStudioWorkspace';
import { LoginModal } from './components/LoginModal';

const DEFAULT_AUTH_POLICY: AuthPolicy = { userMinLength: 6, adminMinLength: 16, registrationEnabled: false };

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [authPolicy, setAuthPolicy] = useState<AuthPolicy>(DEFAULT_AUTH_POLICY);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const refreshUserProfile = React.useCallback(async (): Promise<UserProfile | null> => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (!response.ok) {
        setUser(null);
        return null;
      }
      const data = await response.json();
      const nextUser = data.user || null;
      setUser(nextUser);
      return nextUser;
    } catch (error) {
      console.warn('同步用户状态失败:', error);
      return null;
    }
  }, []);

  // 公开配置（含各等级额度上限）必须与用户状态一起刷新：
  // 后台改了额度后，用户端若只刷新用户对象，就会出现「等级已更新、额度仍是旧值」的错位。
  const refreshPublicConfig = React.useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/config/public');
      const data = await response.json();
      if (data.llmConfig) setLlmConfig(data.llmConfig);
      if (data.authPolicy) setAuthPolicy(data.authPolicy);
    } catch (error) {
      console.warn('同步配置失败:', error);
    }
  }, []);

  React.useEffect(() => {
    void refreshUserProfile();
    void refreshPublicConfig();
    fetch('/api/skills').then((response) => response.json()).then((data) => {
      if (Array.isArray(data.skills) && data.skills.length) setSkills(data.skills);
    }).catch((error) => console.warn('同步技能失败:', error));

    const sync = () => { void refreshUserProfile(); void refreshPublicConfig(); };
    window.addEventListener('focus', sync);
    const handleVisibility = () => { if (document.visibilityState === 'visible') { void refreshUserProfile(); void refreshPublicConfig(); } };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshUserProfile, refreshPublicConfig]);

  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState<'required' | 'quota'>('required');

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans antialiased relative overflow-hidden selection:bg-gray-900 selection:text-white">
      <AiStudioWorkspace
        skills={skills}
        setSkills={setSkills}
        user={user}
        setUser={setUser}
        llmConfig={llmConfig}
        selectedSkill={selectedSkill}
        setSelectedSkill={setSelectedSkill}
        onRefreshUser={refreshUserProfile}
        onOpenLogin={() => { setLoginReason('required'); setIsLoginOpen(true); }}
        onTriggerLogin401={() => { setLoginReason('quota'); setIsLoginOpen(true); }}
      />
      {isLoginOpen && (
        <LoginModal
          llmConfig={llmConfig}
          authPolicy={authPolicy}
          reason={loginReason}
          onSuccess={(nextUser) => { setUser(nextUser); setIsLoginOpen(false); }}
          onClose={() => setIsLoginOpen(false)}
        />
      )}
    </div>
  );
}