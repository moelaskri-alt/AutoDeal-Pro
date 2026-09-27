import { useNavigate } from 'react-router-dom';
import { call, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/actions';
import { useUi } from '../lib/ui';
import { Kpi, Money, PageHeader, Spinner, ErrorAlert, EmptyState } from '../components/common';
import { BarChart, HBars, monthLabel } from '../components/Charts';
import { fmtDate, fmtMoney, fmtNum, fmtPct } from '../../core/format';

export function DashboardPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const { run, busy } = useAction();
  const { data: d, error, loading } = useApi<any>('dashboard.get');
  const info = useApi<any>('app.info');

  if (loading && !d) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!d) return null;
  const fin = d.financial;
  const inv = d.inventory;
  const rec = d.receivables;

  const seed = async () => {
    const ok = await confirm({
      title: 'تحميل بيانات تجريبية',
      message: 'سيتم إنشاء بيانات تجريبية كاملة (20 سيارة، عملاء، مبيعات، أقساط، مصروفات) لتجربة البرنامج. لا يمكن تنفيذ ذلك إلا على قاعدة بيانات فارغة.',
      confirmText: 'تحميل البيانات',
    });
    if (ok) await run(() => call('app.seedDemo'), 'تم تحميل البيانات التجريبية بنجاح');
    info.reload();
  };

  return (
    <div className="stack">
      <PageHeader title="لوحة التحكم" sub={`ملخص أداء المعرض — ${fmtDate(d.today)}`} />

      {info.data?.empty && (
        <div className="card">
          <EmptyState
            icon="car"
            title="مرحباً بك في AutoDeal Pro"
            text="قاعدة البيانات فارغة حالياً. ابدأ بتسجيل أول سيارة من شاشة المشتريات، أو حمّل بيانات تجريبية لاستكشاف البرنامج."
            action={
              <div className="row" style={{ justifyContent: 'center' }}>
                {can('purchases.manage') && (
                  <button className="btn primary" onClick={() => nav('/purchases?new=1')}>
                    تسجيل شراء سيارة
                  </button>
                )}
                {can('vehicles.manage') && (
                  <button className="btn" onClick={() => nav('/vehicles?new=1')}>
                    إضافة سيارة
                  </button>
                )}
                {can('settings.manage') && (
                  <button className="btn" disabled={busy} onClick={seed}>
                    تحميل بيانات تجريبية
                  </button>
                )}
              </div>
            }
          />
        </div>
      )}

      <div className="section-title">المخزون</div>
      <div className="grid-4">
        <Kpi label="سيارات متاحة للبيع" value={fmtNum(inv.available)} sub={`${fmtNum(inv.in_stock)} سيارة بالمعرض إجمالاً`} onClick={() => nav('/vehicles')} />
        <Kpi
          label="سيارات محجوزة"
          value={fmtNum(inv.reserved)}
          sub={`${fmtNum(inv.in_preparation)} تحت التجهيز/الصيانة`}
          onClick={() => nav('/reservations')}
        />
        <Kpi
          label="سيارات مباعة"
          value={fmtNum(inv.sold)}
          sub={`جديدة بالمخزون: ${fmtNum(inv.new_in_stock)} • مستعملة: ${fmtNum(inv.used_in_stock)}`}
          onClick={() => nav('/sales')}
        />
        <Kpi
          label={fin ? 'قيمة المخزون (بالتكلفة)' : 'قيمة المخزون (بسعر البيع)'}
          value={<Money v={fin ? inv.inventory_cost : inv.inventory_asking} />}
          sub={
            fin ? (
              <>
                بسعر البيع: <Money v={inv.inventory_asking} />
              </>
            ) : undefined
          }
        />
      </div>

      <div className="section-title">المبيعات</div>
      <div className="grid-4">
        <Kpi label="مبيعات اليوم" value={<Money v={d.sales.today.revenue} />} sub={`${fmtNum(d.sales.today.count)} سيارة`} tone="accent" />
        <Kpi
          label="مبيعات الشهر"
          value={<Money v={d.sales.month.revenue} />}
          sub={`${fmtNum(d.sales.month.count)} سيارة • متوسط البيع ${fmtMoney(d.sales.month.average)}`}
          tone="accent"
        />
        <Kpi
          label="ربح الشهر"
          value={fin ? <Money v={d.sales.month.profit} /> : '—'}
          sub={fin ? `هامش ${fmtPct(d.sales.month.margin)}` : 'يتطلب صلاحية الأرباح'}
        />
        <Kpi label="متوسط قيمة البيع (الإجمالي)" value={<Money v={d.sales.all.average} />} sub={`${fmtNum(d.sales.all.count)} عملية بيع`} />
      </div>

      <div className="section-title">المديونيات والتحصيل</div>
      <div className="grid-4">
        <Kpi
          label="إجمالي المستحق على العملاء"
          value={<Money v={rec.outstanding} />}
          sub={
            <>
              محصل هذا الشهر: <Money v={rec.collected_month} />
            </>
          }
          onClick={() => nav('/installments')}
        />
        <Kpi
          label="أقساط مستحقة اليوم"
          value={<Money v={rec.due_today} />}
          sub={`${fmtNum(rec.due_today_count)} قسط`}
          onClick={() => nav('/installments?tab=due_today')}
        />
        <Kpi label="أقساط خلال 7 أيام" value={<Money v={rec.due_7} />} sub={`${fmtNum(rec.due_7_count)} قسط`} onClick={() => nav('/installments?tab=next7')} />
        <Kpi
          label="الأقساط المتأخرة"
          value={<Money v={rec.overdue} />}
          sub={`${fmtNum(rec.overdue_count)} قسط • ${fmtNum(rec.overdue_customers)} عميل`}
          tone={rec.overdue > 0 ? 'danger' : undefined}
          onClick={() => nav('/installments?tab=overdue')}
        />
      </div>

      {fin && (
        <>
          <div className="section-title">الربحية (كل المبيعات)</div>
          <div className="grid-4">
            <Kpi label="إجمالي المبيعات" value={<Money v={d.sales.all.revenue} />} />
            <Kpi label="تكلفة السيارات المباعة" value={<Money v={d.sales.all.cost} />} />
            <Kpi label="إجمالي الربح" value={<Money v={d.sales.all.profit} />} tone="accent" />
            <Kpi label="متوسط هامش الربح" value={fmtPct(d.sales.all.margin)} />
          </div>
        </>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <h3>المبيعات {fin ? 'والأرباح ' : ''}الشهرية</h3>
          </div>
          <div className="card-b">
            <BarChart
              labels={d.series.map((s: any) => monthLabel(s.month))}
              series={[
                { name: 'المبيعات', color: '#1e3a5f', values: d.series.map((s: any) => s.revenue) },
                ...(fin ? [{ name: 'الربح', color: '#0f9d76', values: d.series.map((s: any) => s.profit) }] : []),
              ]}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>التحصيل الشهري</h3>
          </div>
          <div className="card-b">
            <BarChart
              labels={d.series.map((s: any) => monthLabel(s.month))}
              series={[
                { name: 'أقساط مستحقة', color: '#cbd5e1', values: d.series.map((s: any) => s.installments_due) },
                { name: 'إجمالي المحصل', color: '#0f9d76', values: d.series.map((s: any) => s.collected) },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <h3>أعمار المخزون</h3>
            <div className="spacer" />
            <span className="muted small">
              {inv.stale_count} سيارة تجاوزت {inv.aging_threshold} يوم
            </span>
          </div>
          <div className="card-b">
            <HBars
              items={d.aging.map((a: any) => ({ label: `${a.bucket} يوم`, value: a.count, sub: fin && a.value ? fmtMoney(a.value) : undefined }))}
              color="#b7791f"
            />
            {can('reports.view') && (
              <button className="link-btn small" style={{ marginTop: 8 }} onClick={() => nav('/reports?id=inventory_aging')}>
                عرض تقرير أعمار المخزون ←
              </button>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>المخزون حسب الماركة</h3>
          </div>
          <div className="card-b">
            <HBars items={d.byBrand.map((b: any) => ({ label: b.brand, value: b.count, sub: fin && b.value ? fmtMoney(b.value) : undefined }))} />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <h3>أعلى المتأخرات</h3>
          </div>
          {d.alerts.top_overdue.length === 0 ? (
            <div className="card-b muted">لا توجد أقساط متأخرة 👍</div>
          ) : (
            <table className="dt">
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>العقد</th>
                  <th>أقدم استحقاق</th>
                  <th>أيام التأخير</th>
                  <th>المتأخر</th>
                </tr>
              </thead>
              <tbody>
                {d.alerts.top_overdue.map((o: any) => (
                  <tr key={o.contract_id} className="clickable" onClick={() => nav(`/installments/${o.contract_id}`)}>
                    <td>{o.customer_name}</td>
                    <td>{o.contract_no}</td>
                    <td>{fmtDate(o.oldest_due)}</td>
                    <td className="num neg">{o.days_overdue}</td>
                    <td className="num neg bold">{fmtMoney(o.overdue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-h">
            <h3>تنبيهات</h3>
          </div>
          <div className="card-b stack">
            {d.alerts.follow_ups_due > 0 && (
              <div className="alert info" role="button" style={{ cursor: 'pointer' }} onClick={() => nav('/leads?due=1')}>
                لديك {d.alerts.follow_ups_due} متابعة عملاء مستحقة اليوم أو متأخرة.
              </div>
            )}
            {inv.stale_count > 0 && (
              <div className="alert warning">
                {inv.stale_count} سيارة راكدة في المخزون لأكثر من {inv.aging_threshold} يوماً.
              </div>
            )}
            {d.alerts.reservations_expiring.map((r: any) => (
              <div key={r.id} className="alert warning" role="button" style={{ cursor: 'pointer' }} onClick={() => nav('/reservations')}>
                حجز {r.reservation_no} ({r.customer_name} — {r.brand} {r.model}) ينتهي في {fmtDate(r.expiry_date)}
              </div>
            ))}
            {d.alerts.follow_ups_due === 0 && inv.stale_count === 0 && d.alerts.reservations_expiring.length === 0 && (
              <div className="muted">لا توجد تنبيهات حالياً.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
