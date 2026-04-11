import { ToastProvider } from '@/components/ui/Toast';
import { SettingsPage } from '@/components/Settings/SettingsPage';

export const metadata = {
  title: 'Settings · Traefik Workbench',
};

export default function Page() {
  return (
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>
  );
}
