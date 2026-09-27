import { useState } from 'react';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card stack" onSubmit={submit} aria-label="تسجيل الدخول">
        <div style={{ textAlign: 'center' }}>
          <div className="logo">AD</div>
          <h2>AutoDeal Pro</h2>
          <div className="muted">نظام إدارة معارض السيارات</div>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div className="field">
          <label htmlFor="username">اسم المستخدم</label>
          <input
            id="username"
            name="username"
            className="input ltr"
            autoFocus
            value={username}
            onChange={(e) => setU(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label htmlFor="password">كلمة المرور</label>
          <input
            id="password"
            name="password"
            className="input ltr"
            type="password"
            value={password}
            onChange={(e) => setP(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="btn primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'جاري الدخول...' : 'تسجيل الدخول'}
        </button>
        <div className="muted small" style={{ textAlign: 'center' }}>
          الدخول الأول: admin / admin123 — يرجى تغيير كلمة المرور بعد الدخول
        </div>
      </form>
    </div>
  );
}
