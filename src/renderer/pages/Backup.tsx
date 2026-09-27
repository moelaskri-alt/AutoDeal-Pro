import { useState } from 'react';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/actions';
import { useUi } from '../lib/ui';
import { Badge, EmptyState, NumberInput, PageHeader, Select, Spinner, Field } from '../components/common';
import { Icon } from '../components/Icon';
import { fmtDateTime } from '../../core/format';

const KIND: Record<string, string> = { manual: 'يدوية', auto: 'تلقائية', pre_restore: 'قبل الاستعادة' };
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

export function BackupPage() {
  const { can, refresh } = useAuth();
  const { confirm, toast } = useUi();
  const { run, busy } = useAction();
  const { data, loading, reload } = useApi<any>('backup.list');
  const settings = useApi<Record<string, string>>('settings.get', undefined, { live: false });
  const [restoring, setRestoring] = useState(false);

  const restore = async (file: string, info?: any) => {
    let meta = info;
    if (!meta) {
      try {
        meta = await call('backup.inspect', { file });
      } catch (e: any) {
        return toast(e.message, 'error');
      }
    }
    const ok = await confirm({
      title: 'استعادة نسخة احتياطية',
      message: (
        <div className="stack">
          <div className="alert warning">
            سيتم استبدال كل البيانات الحالية بمحتوى النسخة المحددة. سيتم أخذ نسخة أمان تلقائية من البيانات الحالية قبل الاستعادة.
          </div>
          <div className="small">
            الملف: <span className="num">{file.split(/[\\/]/).pop()}</span>
          </div>
          <div className="small">
            يحتوي على: {meta.vehicles} سيارة • {meta.customers} عميل • {meta.sales} عملية بيع
          </div>
        </div>
      ),
      typeToConfirm: 'استعادة',
      danger: true,
      confirmText: 'استعادة الآن',
    });
    if (!ok) return;
    setRestoring(true);
    const r: any = await run(() => call('backup.restore', { file, confirm: 'RESTORE' }), 'تمت استعادة النسخة الاحتياطية بنجاح');
    setRestoring(false);
    if (r) {
      await refresh();
      reload();
    }
  };

  const chooseAndRestore = async () => {
    try {
      const r = await call('backup.chooseFile');
      if (r) await restore(r.file, r.info);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  if (loading && !data) return <Spinner />;
  const s = settings.data;
  return (
    <div className="stack">
      <PageHeader
        title="النسخ الاحتياطي والاستعادة"
        sub={
          data ? (
            <>
              مجلد النسخ: <span className="num">{data.dir}</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <button className="btn" onClick={() => call('backup.openFolder')}>
              <Icon name="file" /> فتح المجلد
            </button>
            <button className="btn" disabled={busy || restoring} onClick={chooseAndRestore}>
              <Icon name="refresh" /> استعادة نسخة احتياطية
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                const b: any = await run(() => call('backup.create'), 'تم إنشاء النسخة الاحتياطية');
                if (b) reload();
              }}
            >
              <Icon name="database" /> إنشاء نسخة احتياطية
            </button>
          </>
        }
      />
      {restoring && <div className="alert info">جاري الاستعادة... لا تغلق البرنامج.</div>}
      {s && can('settings.manage') && (
        <div className="card card-b">
          <div className="form-grid cols-3">
            <div className="form-section">النسخ الاحتياطي التلقائي</div>
            <Field label="الحالة">
              <Select
                value={s.auto_backup_enabled}
                onChange={(v) => run(() => call('settings.save', { auto_backup_enabled: v }).then(() => settings.reload()), 'تم الحفظ')}
                options={[
                  ['1', 'مفعل'],
                  ['0', 'متوقف'],
                ]}
              />
            </Field>
            <Field label="كل (ساعة)">
              <NumberInput
                value={Number(s.auto_backup_interval_hours)}
                onChange={(v) => v && run(() => call('settings.save', { auto_backup_interval_hours: v }).then(() => settings.reload()))}
                min={1}
              />
            </Field>
            <Field label="الاحتفاظ بآخر (نسخة)">
              <NumberInput
                value={Number(s.auto_backup_keep)}
                onChange={(v) => v && run(() => call('settings.save', { auto_backup_keep: v }).then(() => settings.reload()))}
                min={1}
              />
            </Field>
            <div className="full muted small">
              آخر نسخة تلقائية: {data?.last_auto ? fmtDateTime(data.last_auto) : 'لم تُنشأ بعد'} — يتم النسخ عند تشغيل البرنامج وكل فترة وعند إغلاقه.
              <button
                className="link-btn"
                style={{ marginInlineStart: 8 }}
                onClick={async () => {
                  const d = await call('backup.chooseDir');
                  if (d) {
                    await run(() => call('settings.save', { backup_dir: d }), 'تم تغيير مجلد النسخ');
                    reload();
                  }
                }}
              >
                تغيير مجلد النسخ (مثلاً فلاشة أو قرص آخر)
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-h">
          <h3>النسخ المتوفرة</h3>
        </div>
        {!data?.items.length ? (
          <EmptyState icon="database" title="لا توجد نسخ احتياطية بعد" text="أنشئ نسخة احتياطية الآن واحتفظ بنسخة على وسيط خارجي." />
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>الملف</th>
                <th>النوع</th>
                <th>التاريخ</th>
                <th>الحجم</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((b: any) => (
                <tr key={b.file}>
                  <td className="num small">{b.name}</td>
                  <td>
                    <Badge value={b.kind === 'manual' ? 'open' : b.kind === 'auto' ? 'active' : 'expired'} text={KIND[b.kind] ?? b.kind} />
                  </td>
                  <td>{fmtDateTime(b.created_at)}</td>
                  <td className="num">{size(b.size)}</td>
                  <td className="actions">
                    <button className="btn sm" disabled={busy || restoring} onClick={() => restore(b.file)}>
                      استعادة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
