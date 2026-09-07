import React, { useState } from 'react';
import { UserProfile, Skill, LLMConfig, getEffectiveMembershipTier } from './types';
import { INITIAL_SKILLS, GUEST_USER, DEFAULT_LLM_CONFIG } from './data/initialData';
import { AiStudioWorkspace } from './components/AiStudioWorkspace';
import { LoginModal } from './components/LoginModal';

export default function App() {
  const [user, setUser] = useState<UserProfile>(GUEST_USER);
  const [skills, setSkills] = useState<Skill[]>(INITIAL_SKILLS);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  // Sync with backend database on mount & revalidation
  const refreshUserProfile = React.useCallback(() => {
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch('/api/auth/me', { headers })
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
        }
        return data.user;
      })
      .catch((e) => console.warn('Sync user error:', e));
  }, []);

  React.useEffect(() => {
    refreshUserProfile();

    // Listen to tab focus & visibility changes to keep user data in perfect sync with backend
    const handleFocus = () => {
      refreshUserProfile();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshUserProfile();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    fetch('/api/skills')
      .then((res) => res.json())
      .then((data) => {
        if (data.skills && data.skills.length > 0) setSkills(data.skills);
      })
      .catch((e) => console.warn('Sync skills error:', e));

    fetch('/api/config/public')
      .then((res) => res.json())
      .then((data) => {
        if (data.llmConfig) {
          setLlmConfig(data.llmConfig);
          setUser((prev) => {
            const effTier = getEffectiveMembershipTier(prev);
            let limit = data.llmConfig.dailyLimits?.freeMember ?? 10;
            if (prev.role === 'guest') {
              limit = data.llmConfig.dailyLimits?.guestUser ?? 3;
            } else if (effTier === 'monthly_member') {
              limit = data.llmConfig.dailyLimits?.monthlyMember ?? 100;
            } else if (effTier === 'quarterly_member') {
              limit = data.llmConfig.dailyLimits?.quarterlyMember ?? 200;
            } else if (effTier === 'yearly_member') {
              limit = data.llmConfig.dailyLimits?.yearlyMember ?? 500;
            }
            return { ...prev, dailyMaxChats: limit };
          });
        }
      })
      .catch((e) => console.warn('Sync LLM config error:', e));

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshUserProfile]);

  // Modals & Navigation state
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isLoginTriggeredBy401, setIsLoginTriggeredBy401] = useState(false);

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans antialiased relative overflow-hidden selection:bg-gray-900 selection:text-white">
      {/* Google AI Studio Workspace Layout */}
      <AiStudioWorkspace
        skills={skills}
        setSkills={setSkills}
        user={user}
        setUser={setUser}
        llmConfig={llmConfig}
        selectedSkill={selectedSkill}
        setSelectedSkill={setSelectedSkill}
        onRefreshUser={refreshUserProfile}
        onOpenLogin={() => {
          setIsLoginTriggeredBy401(false);
          setIsLoginOpen(true);
        }}
        onTriggerLogin401={() => {
          setIsLoginTriggeredBy401(true);
          setIsLoginOpen(true);
        }}
      />

      {/* Modals */}
      {isLoginOpen && (
        <LoginModal
          llmConfig={llmConfig}
          isTriggeredBy401={isLoginTriggeredBy401}
          onSuccess={(updatedFields) => {
            setUser((prev) => ({ ...prev, ...updatedFields }));
            setIsLoginOpen(false);
            setIsLoginTriggeredBy401(false);
          }}
          onClose={() => {
            setIsLoginOpen(false);
            setIsLoginTriggeredBy401(false);
          }}
        />
      )}
    </div>
  );
}
