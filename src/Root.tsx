import { lazy, Suspense } from 'react';
import App from './App';
import { AuthProvider } from './lib/auth';
const Shop = lazy(() => import('./pages/Shop'));
export function Root() {
  const staffRoute = location.pathname === '/staff' || location.pathname.startsWith('/staff/') || location.pathname.startsWith('/workshop/');
  return staffRoute ? <AuthProvider><App /></AuthProvider> : <Suspense fallback={<p className="p-10 text-sm">Loading Awutorla…</p>}><Shop /></Suspense>;
}
