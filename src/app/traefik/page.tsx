import { ToastProvider } from '@/components/ui/Toast';
import { TraefikPage } from '@/components/Traefik/TraefikPage';

export const metadata = {
  // Wrapped by the root layout's title template into "Traefik · Traefik Workbench".
  title: 'Traefik',
};

export default function Page() {
  return (
    <ToastProvider>
      <TraefikPage />
    </ToastProvider>
  );
}
