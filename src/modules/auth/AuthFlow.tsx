import { useState } from 'react';
import { CreateInstitutionScreen } from './CreateInstitutionScreen';
import { JoinInstitutionScreen } from './JoinInstitutionScreen';
import { LoginScreen } from './LoginScreen';
import { WelcomeScreen } from './WelcomeScreen';

type AuthScreen = 'welcome' | 'create' | 'join' | 'login';

export function AuthFlow() {
  const [screen, setScreen] = useState<AuthScreen>('welcome');
  const [restoredNotice, setRestoredNotice] = useState(false);

  const goWelcome = () => {
    setRestoredNotice(false);
    setScreen('welcome');
  };

  switch (screen) {
    case 'create':
      return <CreateInstitutionScreen onBack={goWelcome} />;
    case 'join':
      return <JoinInstitutionScreen onBack={goWelcome} />;
    case 'login':
      return <LoginScreen onBack={goWelcome} restoredBanner={restoredNotice} />;
    default:
      return (
        <WelcomeScreen
          onCreate={() => setScreen('create')}
          onJoin={() => setScreen('join')}
          onLogin={() => {
            setRestoredNotice(false);
            setScreen('login');
          }}
          onRestored={() => {
            setRestoredNotice(true);
            setScreen('login');
          }}
        />
      );
  }
}
