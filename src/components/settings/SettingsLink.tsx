import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { useSettings } from './SettingsProvider';

interface SettingsLinkProps {
  className?: string;
  showLabel?: boolean;
  onClick?: () => void;
}

export function SettingsLink({ className = '', showLabel = true, onClick }: SettingsLinkProps) {
  const { t } = useSettings();

  return (
    <Link
      className={`settings-nav-link ${className}`.trim()}
      href="/settings"
      aria-label={t('settingsNavAria')}
      onClick={onClick}
    >
      <Settings2 aria-hidden="true" />
      {showLabel && <span>{t('settingsTitle')}</span>}
    </Link>
  );
}
