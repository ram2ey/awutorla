import { useState, useEffect, lazy, Suspense } from 'react';
import {
  LayoutDashboard,
  Users,
  Settings as SettingsIcon,
  UserPlus,
  LogOut,
} from 'lucide-react';
import { TopNavBar } from './components/ui/TopNavBar';
import type { DockItem } from './components/ui/TopNavBar';
import { AuthScreen } from './components/auth/AuthScreen';
import { SetNewPasswordScreen } from './components/auth/SetNewPasswordScreen';
import { useAuth } from './lib/auth';
import { fetchAppSettings, DEFAULT_APP_SETTINGS } from './lib/settings';
import { OfflineWorkspace } from './components/workshop/OfflineWorkspace';
const StaffDashboard=lazy(()=>import('./pages/StaffDashboard'));
const Clients=lazy(()=>import('./pages/Clients'));
const AdminSettings=lazy(()=>import('./pages/AdminSettings'));
const QuickIntakeModal=lazy(()=>import('./components/workshop/QuickIntakeModal'));

function App() {
  const { session, profile, loading: authLoading, isPasswordRecovery, signOut } = useAuth();

  const [activeTab, setActiveTab] = useState<string>('');
  const [isIntakeOpen, setIsIntakeOpen] = useState<boolean>(false);
  const [businessName, setBusinessName] = useState<string>(DEFAULT_APP_SETTINGS.business_name);

  useEffect(() => {
    setActiveTab('dashboard');
    setIsIntakeOpen(false);
  }, [session?.user.id, profile?.role]);

  useEffect(() => {
    if (!session) return;
    fetchAppSettings()
      .then((settings) => setBusinessName(settings.business_name))
      .catch((err) => console.error('[App] Failed to load business settings:', err));
  }, [session]);

  const isStaff = profile?.role === 'tailor' || profile?.role === 'admin';
  const isAdmin = profile?.role === 'admin';

  const dockItems: DockItem[] = [
        {
          id: 'dashboard',
          label: 'Dashboard',
          icon: <LayoutDashboard size={19} />,
          onClick: () => setActiveTab('dashboard'),
        },
        {
          id: 'clients',
          label: 'Clients',
          icon: <Users size={19} />,
          onClick: () => setActiveTab('clients'),
        },
        // Gated on the real account role (not a preview toggle) — this controls
        // navigation to a page that performs privileged writes.
        ...(isAdmin
          ? [
              {
                id: 'settings',
                label: 'Settings',
                icon: <SettingsIcon size={19} />,
                onClick: () => setActiveTab('settings'),
              },
            ]
          : []),
      ];

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center gap-3">
        <img src="/logo.png" alt="Awutorla" className="h-14 w-auto animate-pulse" />
      </div>
    );
  }

  if (!session) return <AuthScreen />;
  if (!isStaff || profile?.id !== session.user.id) {
    return <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-100 p-6">
      <p className="text-sm">This workspace is available to atelier staff only.</p>
      <button onClick={() => signOut()} className="rounded-xl bg-charcoal-950 text-white px-5 py-2 text-sm">Back to staff sign in</button>
    </div>;
  }
  if (isPasswordRecovery) return <SetNewPasswordScreen />;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-sans p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 lg:p-8 relative overflow-x-hidden">
      <div className="max-w-7xl mx-auto rounded-3xl shadow-mega-card bg-cream-100 overflow-hidden">

        {/* Brand Header */}
        <header className="px-4 sm:px-8 py-4 border-b border-gray-200/80">
          <div className="flex flex-col lg:flex-row justify-between items-center gap-4">

            {/* Brand Insignia */}
            <div className="flex items-center shrink-0">
              <img src="/logo.png" alt={businessName} className="h-10 sm:h-12 w-auto" />
            </div>

            {/* Primary Navigation */}
            <TopNavBar items={dockItems} activeId={activeTab} className="order-3 lg:order-2" />

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2.5 justify-center order-2 lg:order-3">

              {/* Quick Intake Button (Tailor/Admin) — gated on the real account role */}
              {isStaff && (
                <button
                  onClick={() => setIsIntakeOpen(true)}
                  className="px-4 py-2 text-xs font-semibold text-charcoal-950 bg-mustard-400 hover:bg-mustard-300 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 flex items-center gap-2"
                >
                  <UserPlus size={15} />
                  <span>New Intake</span>
                </button>
              )}

              {/* Signed-in Identity & Sign Out */}
              <div className="flex items-center gap-2 pl-1 text-xs">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200/60 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-gray-700 font-medium max-w-[140px] truncate">
                    {profile?.full_name || session.user.email}
                  </span>
                </div>
                <button
                  onClick={() => signOut()}
                  className="w-8 h-8 rounded-xl bg-gray-50 hover:bg-rose-50 hover:text-rose-700 border border-gray-200/70 flex items-center justify-center transition-colors text-gray-500 shadow-sm"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Workspace */}
        <main className="px-4 sm:px-6 py-8 sm:py-10"><Suspense fallback={<p className="text-sm">Loading workspace…</p>}>
          <OfflineWorkspace key={`offline:${session.user.id}`}/>

          {isStaff && activeTab === 'dashboard' && <StaffDashboard key={session.user.id} />}
          {isStaff && activeTab === 'clients' && <Clients key={session.user.id} />}
          {isStaff && isAdmin && activeTab === 'settings' && <AdminSettings />}


        </Suspense></main>
      </div>

      {/* Rapid Bespoke Intake Modal */}
      <Suspense fallback={null}><QuickIntakeModal
        isOpen={isIntakeOpen}
        onClose={() => setIsIntakeOpen(false)}
        onOrderCreated={() => {
          setIsIntakeOpen(false);
          setActiveTab('clients');
        }}
      /></Suspense>

    </div>
  );
}

export default App;
