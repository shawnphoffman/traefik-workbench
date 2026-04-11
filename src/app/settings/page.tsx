import { ToastProvider } from '@/components/ui/Toast';
import { SettingsPage } from '@/components/Settings/SettingsPage';

export const metadata = {
  // The root layout's title template wraps this as "Settings · Traefik Workbench".
  title: 'Settings',
};

export default function Page() {
  return (
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>
  );
}
