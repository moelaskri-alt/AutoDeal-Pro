import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ConfirmOpts {
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** Ask the user for a reason (returned as the resolved string). */
  reason?: { label: string; required?: boolean };
  /** Require typing this word to enable the confirm button (for destructive operations). */
  typeToConfirm?: string;
}

interface UiState {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (o: ConfirmOpts) => Promise<string | false>;
}

const UiCtx = createContext<UiState>(null as any);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: string | false) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback((o: ConfirmOpts) => {
    setReason('');
    setTyped('');
    return new Promise<string | false>((resolve) => setDlg({ ...o, resolve }));
  }, []);

  const close = (v: string | false) => {
    dlg?.resolve(v);
    setDlg(null);
  };
  const disabled = (dlg?.reason?.required && !reason.trim()) || (dlg?.typeToConfirm && typed.trim() !== dlg.typeToConfirm);

  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast-wrap" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
      {dlg && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal sm" role="alertdialog" aria-label={dlg.title}>
            <div className="modal-h">
              <h3>{dlg.title}</h3>
              <button className="x-btn" onClick={() => close(false)} aria-label="إغلاق">
                ×
              </button>
            </div>
            <div className="modal-b stack">
              <div>{dlg.message}</div>
              {dlg.reason && (
                <div className="field">
                  <label>
                    {dlg.reason.label} {dlg.reason.required && <span className="req">*</span>}
                  </label>
                  <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                </div>
              )}
              {dlg.typeToConfirm && (
                <div className="field">
                  <label>
                    للتأكيد اكتب: <b>{dlg.typeToConfirm}</b>
                  </label>
                  <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus={!dlg.reason} />
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className={`btn ${dlg.danger ? 'danger' : 'primary'}`} disabled={!!disabled} onClick={() => close(reason.trim() || 'yes')}>
                {dlg.confirmText ?? 'تأكيد'}
              </button>
              <button className="btn" onClick={() => close(false)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </UiCtx.Provider>
  );
}

export const useUi = () => useContext(UiCtx);
