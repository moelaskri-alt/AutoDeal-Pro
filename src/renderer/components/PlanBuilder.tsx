import { useEffect, useState } from 'react';
import { call } from '../lib/api';
import { addMonthsStr, today } from '../lib/actions';
import { DateInput, Field, MoneyInput, NumberInput, Select } from './common';
import { Icon } from './Icon';
import { fmtDate, fmtMoney } from '../../core/format';

export interface Plan {
  plan_type: 'equal' | 'custom' | 'balloon';
  count?: number;
  first_due_date?: string;
  interval_months?: number;
  regular_amount?: number | null;
  lines?: { due_date: string; amount: number | null }[];
}

export const defaultPlan = (start?: string): Plan => ({ plan_type: 'equal', count: 12, first_due_date: addMonthsStr(start ?? today(), 1), interval_months: 1 });

/**
 * Installment plan editor: equal / balloon (server preview) or fully custom lines.
 * Reports validity to the parent: a custom plan is valid only when it sums exactly to `total`.
 */
export function PlanBuilder({ total, plan, onChange, onValidity }: { total: number; plan: Plan; onChange: (p: Plan) => void; onValidity: (ok: boolean, msg?: string) => void }) {
  const [preview, setPreview] = useState<{ due_date: string; amount: number; seq: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Plan, v: any) => onChange({ ...plan, [k]: v });

  const customSum = (plan.lines ?? []).reduce((a, l) => a + (l.amount ?? 0), 0);
  const diff = total - customSum;

  useEffect(() => {
    if (plan.plan_type === 'custom') {
      const bad = (plan.lines ?? []).some((l) => !l.amount || !l.due_date);
      const ok = total > 0 && (plan.lines?.length ?? 0) > 0 && !bad && diff === 0;
      setErr(null);
      onValidity(ok, !ok ? (diff !== 0 ? 'مجموع الأقساط لا يساوي المبلغ المطلوب تقسيطه' : 'أكمل بيانات جميع الأقساط') : undefined);
      return;
    }
    if (total <= 0) {
      setPreview([]);
      onValidity(false, 'لا يوجد مبلغ للتقسيط');
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      call('installments.preview', { total, plan })
        .then((r) => {
          if (!alive) return;
          setPreview(r.lines);
          setErr(null);
          onValidity(true);
        })
        .catch((e) => {
          if (!alive) return;
          setPreview([]);
          setErr(e.message);
          onValidity(false, e.message);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [total, JSON.stringify(plan)]);

  const toCustom = () => {
    const lines = preview.length ? preview.map((l) => ({ due_date: l.due_date, amount: l.amount })) : [{ due_date: plan.first_due_date ?? addMonthsStr(today(), 1), amount: total }];
    onChange({ ...plan, plan_type: 'custom', lines });
  };

  return (
    <div className="stack">
      <div className="form-grid cols-3">
        <Field label="نظام التقسيط">
          <Select
            name="plan_type"
            value={plan.plan_type}
            onChange={(v) => (v === 'custom' ? toCustom() : onChange({ ...plan, plan_type: v as any, lines: undefined }))}
            options={[
              ['equal', 'أقساط شهرية متساوية'],
              ['balloon', 'أقساط + دفعة أخيرة كبيرة (Balloon)'],
              ['custom', 'جدول مخصص (مبالغ وتواريخ مختلفة)'],
            ]}
          />
        </Field>
        {plan.plan_type !== 'custom' && (
          <>
            <Field label="عدد الأقساط">
              <NumberInput name="count" value={plan.count} onChange={(v) => set('count', v ?? undefined)} min={1} max={360} />
            </Field>
            <Field label="تاريخ أول قسط">
              <DateInput name="first_due_date" value={plan.first_due_date} onChange={(v) => set('first_due_date', v)} />
            </Field>
            <Field label="كل (شهر)">
              <NumberInput value={plan.interval_months ?? 1} onChange={(v) => set('interval_months', v ?? 1)} min={1} max={12} />
            </Field>
            {plan.plan_type === 'balloon' && (
              <Field label="قيمة القسط الدوري" hint="الدفعة الأخيرة = الباقي">
                <MoneyInput value={plan.regular_amount} onChange={(v) => set('regular_amount', v)} />
              </Field>
            )}
          </>
        )}
      </div>
      {err && <div className="alert error">{err}</div>}
      {plan.plan_type === 'custom' ? (
        <div className="card">
          <div className="table-wrap">
            <table className="dt schedule-editor">
              <thead>
                <tr>
                  <th>#</th>
                  <th>تاريخ الاستحقاق</th>
                  <th>المبلغ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(plan.lines ?? []).map((l, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <DateInput value={l.due_date} onChange={(v) => set('lines', plan.lines!.map((x, j) => (j === i ? { ...x, due_date: v } : x)))} />
                    </td>
                    <td>
                      <MoneyInput value={l.amount} onChange={(v) => set('lines', plan.lines!.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                    </td>
                    <td>
                      <button className="btn sm ghost" onClick={() => set('lines', plan.lines!.filter((_, j) => j !== i))} aria-label="حذف القسط">
                        <Icon name="x" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>مجموع الأقساط / المطلوب</td>
                  <td className="num">
                    {fmtMoney(customSum)} / {fmtMoney(total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="toolbar" style={{ borderBottom: 0, borderTop: '1px solid var(--border)' }}>
            <button
              className="btn sm"
              onClick={() => {
                const last = plan.lines?.[plan.lines.length - 1];
                set('lines', [...(plan.lines ?? []), { due_date: last ? addMonthsStr(last.due_date, 1) : addMonthsStr(today(), 1), amount: diff > 0 ? diff : null }]);
              }}
            >
              <Icon name="plus" /> إضافة قسط
            </button>
            {diff !== 0 && plan.lines?.length ? (
              <button className="btn sm" onClick={() => set('lines', plan.lines!.map((x, j) => (j === plan.lines!.length - 1 ? { ...x, amount: (x.amount ?? 0) + diff } : x)))}>
                إضافة الفرق للقسط الأخير
              </button>
            ) : null}
            <div className="spacer" />
            {diff === 0 ? <span className="badge green">الجدول متوازن ✓</span> : <span className="badge red">الفرق: {fmtMoney(diff)} — لا يمكن الحفظ</span>}
          </div>
        </div>
      ) : (
        preview.length > 0 && (
          <div className="card">
            <div className="card-h">
              <h3>معاينة جدول الأقساط</h3>
              <div className="spacer" />
              <span className="muted small">
                {preview.length} قسط • الإجمالي {fmtMoney(preview.reduce((a, l) => a + l.amount, 0))}
              </span>
              <button className="btn sm" onClick={toCustom}>
                تعديل يدوي
              </button>
            </div>
            <div className="table-wrap" style={{ maxHeight: 260 }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>تاريخ الاستحقاق</th>
                    <th>المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((l) => (
                    <tr key={l.seq}>
                      <td>{l.seq}</td>
                      <td>{fmtDate(l.due_date)}</td>
                      <td className="num">{fmtMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
