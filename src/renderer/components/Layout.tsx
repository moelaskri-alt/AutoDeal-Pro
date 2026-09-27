import { NavLink, useLocation } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { ChangePasswordModal } from '../pages/Users';

export const NAV: { to: string; label: string; icon: string; perm: string; section?: string }[] = [
  { to: '/', label: 'لوحة التحكم', icon: 'dashboard', perm: 'dashboard.view' },
  { to: '/vehicles', label: 'السيارات', icon: 'car', perm: 'vehicles.view', section: 'المخزون' },
  { to: '/purchases', label: 'المشتريات', icon: 'cart', perm: 'purchases.view' },
  { to: '/costs', label: 'تكاليف السيارات', icon: 'wrench', perm: 'costs.view' },
  { to: '/customers', label: 'العملاء', icon: 'users', perm: 'customers.view', section: 'المبيعات' },
  { to: '/leads', label: 'العملاء المحتملون', icon: 'target', perm: 'leads.view' },
  { to: '/quotations', label: 'عروض الأسعار', icon: 'file', perm: 'quotations.view' },
  { to: '/reservations', label: 'الحجوزات', icon: 'bookmark', perm: 'reservations.view' },
  { to: '/sales', label: 'المبيعات', icon: 'tag', perm: 'sales.view' },
  { to: '/installments', label: 'التقسيط والتحصيل', icon: 'calendar', perm: 'installments.view' },
  { to: '/tradeins', label: 'الاستبدال (Trade-In)', icon: 'swap', perm: 'tradeins.view' },
  { to: '/expenses', label: 'المصروفات', icon: 'wallet', perm: 'expenses.view', section: 'الإدارة' },
  { to: '/reports', label: 'التقارير', icon: 'chart', perm: 'reports.view' },
  { to: '/users', label: 'المستخدمون والصلاحيات', icon: 'shield', perm: 'users.manage|audit.view' },
  { to: '/settings', label: 'الإعدادات', icon: 'settings', perm: 'settings.manage' },
  { to: '/backup', label: 'النسخ الاحتياطي', icon: 'database', perm: 'backup.manage' },
];

export const allowed = (can: (p: string) => boolean, perm: string) => perm.split('|').some((p) => can(p));

export function Layout({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAuth();
  const { confirm } = useUi();
  const loc = useLocation();
  const [pw, setPw] = useState(false);
  const current = [...NAV].reverse().find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)));
  let lastSection: string | undefined;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">AD</div>
          <div>
            <b>AutoDeal Pro</b>
            <span>إدارة معارض السيارات</span>
          </div>
        </div>
        <nav aria-label="القائمة الرئيسية">
          {NAV.filter((n) => allowed(can, n.perm)).map((n) => {
            const sec = n.section && n.section !== lastSection ? n.section : null;
            if (n.section) lastSection = n.section;
            return (
              <div key={n.to} style={{ display: 'contents' }}>
                {sec && <div className="section">{sec}</div>}
                <NavLink to={n.to} end={n.to === '/'}>
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                </NavLink>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="title">{current?.label ?? 'AutoDeal Pro'}</div>
          <div className="spacer" />
          <div className="user">
            <div className="avatar">{user?.full_name?.slice(0, 1)}</div>
            <div style={{ lineHeight: 1.25 }}>
              <div className="bold">{user?.full_name}</div>
              <div className="muted small">{user?.role_name}</div>
            </div>
            <button className="btn sm ghost" onClick={() => setPw(true)} title="تغيير كلمة المرور">
              <Icon name="settings" />
            </button>
            <button
              className="btn sm"
              onClick={async () => {
                if (await confirm({ title: 'تسجيل الخروج', message: 'هل تريد تسجيل الخروج من البرنامج؟', confirmText: 'تسجيل الخروج' })) logout();
              }}
            >
              <Icon name="logout" /> خروج
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      {pw && <ChangePasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}
