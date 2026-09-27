import type { Db } from '../db/database';
import type { Ctx } from '../context';
import { callApi } from '../api';
import { addDays, addMonths } from '../calc/dates';
import { fail } from '../errors';
import { hashPassword } from '../security';

const M = (n: number) => Math.round(n * 100);

/**
 * Loads a realistic demo dataset THROUGH the business services (so every rule, cost card,
 * schedule and audit entry is produced exactly as in real use). Only allowed on an empty database.
 */
export function seedDemo(db: Db, adminCtx: Ctx) {
  if (db.scalar<number>('SELECT COUNT(*) FROM vehicles') > 0 || db.scalar<number>('SELECT COUNT(*) FROM customers') > 0) {
    fail('NOT_EMPTY', 'لا يمكن تحميل البيانات التجريبية لأن قاعدة البيانات تحتوي على بيانات بالفعل.');
  }
  const T = adminCtx.today!;
  const d = (n: number) => addDays(T, -n);
  const call = (m: string, a: any) => callApi(db, adminCtx, m, a) as any;

  return db.tx(() => {
    // ---------------------------------------------------------------- users per role
    const role = (code: string) => db.scalar<number>('SELECT id FROM roles WHERE code = ?', [code]);
    const demoUsers = [
      ['manager', 'مدير المعرض - خالد', 'manager', 'manager123'],
      ['sales', 'مندوب مبيعات - سارة', 'sales', 'sales123'],
      ['sales2', 'مندوب مبيعات - عمر', 'sales', 'sales123'],
      ['accountant', 'المحاسب - منى', 'accountant', 'account123'],
      ['viewer', 'مراجع - مشاهد فقط', 'viewer', 'viewer123'],
    ];
    const uid: Record<string, number> = {};
    for (const [u, name, r, pw] of demoUsers) {
      uid[u] = db.run('INSERT INTO users(username, full_name, password_hash, role_id) VALUES (?,?,?,?)', [u, name, hashPassword(pw), role(r)]).lastId;
    }

    // ---------------------------------------------------------------- settings
    call('settings.save', { company_name: 'معرض النخبة للسيارات', company_phone: '0223456789', company_address: 'القاهرة - مدينة نصر - شارع عباس العقاد' });

    // ---------------------------------------------------------------- suppliers
    const sup = (name: string, supplier_type: string, phone: string) => call('suppliers.create', { name, supplier_type, phone }).id;
    const agent = sup('الوكيل المعتمد - المصرية للسيارات', 'agent', '0225550000');
    const dealer = sup('معرض الأمانة للسيارات المستعملة', 'dealer', '01011112222');
    const indiv = sup('محمد عبد الله (بائع فرد)', 'individual', '01233334444');
    const workshop = sup('ورشة الإتقان للصيانة والسمكرة', 'workshop', '01144445555');

    // ---------------------------------------------------------------- 10 new + 9 used purchased vehicles
    type P = [string, string, string, number, string, number, number, number, number, 'new' | 'used', number, number];
    // brand, model, trim, year, color, mileage, price, asking, min, condition, supplier, daysAgo
    const list: P[] = [
      ['Toyota', 'Corolla', 'Elite', 2025, 'أبيض', 0, 1320000, 1480000, 1420000, 'new', agent, 95],
      ['Toyota', 'Corolla', 'Smart', 2025, 'فضي', 0, 1250000, 1395000, 1340000, 'new', agent, 30],
      ['Hyundai', 'Elantra', 'CN7 Smart', 2025, 'رمادي', 0, 1180000, 1320000, 1270000, 'new', agent, 120],
      ['Kia', 'Sportage', 'GT-Line', 2025, 'أسود', 0, 1850000, 2090000, 2000000, 'new', agent, 110],
      ['Kia', 'Cerato', 'Top Line', 2025, 'أحمر', 0, 1050000, 1180000, 1130000, 'new', agent, 12],
      ['Nissan', 'Sunny', 'Super Saloon', 2025, 'أبيض', 0, 820000, 925000, 885000, 'new', agent, 65],
      ['Chery', 'Tiggo 7 Pro', 'Max', 2025, 'أزرق', 0, 1290000, 1450000, 1390000, 'new', agent, 45],
      ['MG', 'ZS', 'Luxury', 2025, 'أبيض', 0, 980000, 1110000, 1060000, 'new', agent, 140],
      ['Renault', 'Duster', 'Prestige', 2025, 'برتقالي', 0, 1100000, 1240000, 1190000, 'new', agent, 8],
      ['Skoda', 'Octavia', 'Style', 2025, 'رمادي', 0, 1750000, 1960000, 1880000, 'new', agent, 70],
      ['Hyundai', 'Tucson', 'Limited', 2021, 'أبيض', 62000, 1150000, 1320000, 1250000, 'used', dealer, 60],
      ['BMW', '320i', 'M Sport', 2019, 'أزرق', 88000, 1450000, 1650000, 1560000, 'used', indiv, 150],
      ['Mercedes', 'C200', 'AMG Line', 2020, 'أسود', 71000, 1900000, 2150000, 2050000, 'used', dealer, 85],
      ['Nissan', 'Sunny', 'Super Saloon', 2020, 'فضي', 95000, 480000, 560000, 530000, 'used', indiv, 100],
      ['Toyota', 'Fortuner', 'VXR', 2018, 'أبيض', 140000, 1350000, 1520000, 1450000, 'used', dealer, 35],
      ['Kia', 'Picanto', 'GL', 2019, 'أحمر', 76000, 390000, 455000, 430000, 'used', indiv, 20],
      ['Mitsubishi', 'Lancer', 'Shark', 2017, 'أسود', 130000, 420000, 495000, 465000, 'used', dealer, 125],
      ['Peugeot', '3008', 'Allure', 2020, 'رمادي', 83000, 1050000, 1200000, 1140000, 'used', dealer, 55],
      ['Hyundai', 'Accent', 'RB', 2018, 'فضي', 120000, 430000, 505000, 480000, 'used', indiv, 15],
    ];
    const veh: number[] = [];
    list.forEach((p, i) => {
      const [brand, model, trim, year, color, mileage, price, asking, min, condition, supplier, ago] = p;
      const r = call('purchases.create', {
        purchase_date: d(ago),
        purchase_price: M(price),
        supplier_id: supplier,
        invoice_no: `INV-${1000 + i}`,
        status: condition === 'new' ? 'available' : 'preparation',
        paid_amount: M(i % 4 === 0 ? price / 2 : price),
        pay_method: i % 2 ? 'bank_transfer' : 'cash',
        pay_reference: i % 2 ? `TRX-${5000 + i}` : undefined,
        vehicle: {
          condition,
          brand,
          model,
          trim,
          model_year: year,
          color,
          mileage,
          vin: `${condition === 'new' ? 'NEW' : 'USD'}${brand.slice(0, 3).toUpperCase()}${String(20250000 + i * 7919).padStart(11, '0')}`,
          engine_no: `ENG${String(880000 + i * 131)}`,
          plate_no: condition === 'used' ? `س ص ${1200 + i * 37}` : undefined,
          transmission: 'أوتوماتيك',
          fuel_type: 'بنزين',
          body_type: ['Tucson', 'Sportage', 'Fortuner', 'Tiggo 7 Pro', 'ZS', 'Duster', '3008'].includes(model) ? 'SUV' : 'سيدان',
          origin_country: ['Toyota', 'Nissan', 'Mitsubishi'].includes(brand)
            ? 'اليابان'
            : ['Hyundai', 'Kia'].includes(brand)
              ? 'كوريا'
              : ['BMW', 'Mercedes', 'Skoda'].includes(brand)
                ? 'ألمانيا'
                : ['Chery', 'MG'].includes(brand)
                  ? 'الصين'
                  : 'فرنسا',
          asking_price: M(asking),
          min_price: M(min),
        },
        costs: condition === 'new' ? [{ category: 'transport', amount: M(3500), description: 'نقل من الوكيل' }] : [],
      });
      veh.push(r.vehicle_id);
    });
    // used cars in preparation become available after prep – except two still under preparation/maintenance
    for (let i = 10; i < 19; i++) if (i !== 16) call('vehicles.update', { ...db.get('SELECT * FROM vehicles WHERE id = ?', [veh[i]]), status: 'available' });
    call('vehicles.update', { ...db.get('SELECT * FROM vehicles WHERE id = ?', [veh[16]]), status: 'maintenance' });

    // ---------------------------------------------------------------- 10+ direct vehicle expenses
    const cost = (v: number, ago: number, category: string, amount: number, description: string, supplier_id?: number) =>
      call('costs.create', { vehicle_id: v, expense_date: d(ago), category, amount: M(amount), description, supplier_id, payment_method: 'cash' });
    cost(veh[10], 58, 'maintenance', 18000, 'صيانة شاملة وتغيير زيوت', workshop);
    cost(veh[10], 57, 'tires', 16000, '4 إطارات جديدة');
    cost(veh[11], 148, 'bodywork', 22000, 'سمكرة الباب الخلفي', workshop);
    cost(veh[11], 147, 'paint', 14000, 'دهان الرفرف والباب', workshop);
    cost(veh[11], 140, 'detailing', 3500, 'تلميع وتنظيف داخلي');
    cost(veh[12], 83, 'maintenance', 27000, 'صيانة 70 ألف كم', workshop);
    cost(veh[12], 82, 'registration', 6500, 'نقل ملكية وترخيص');
    cost(veh[13], 98, 'parts', 9000, 'تيل فرامل وبطارية');
    cost(veh[13], 97, 'detailing', 2500, 'غسيل وتلميع');
    cost(veh[14], 33, 'tires', 21000, 'إطارات جديدة مقاس 17');
    cost(veh[16], 120, 'maintenance', 12500, 'إصلاح ناقل الحركة', workshop);
    cost(veh[17], 52, 'accessories', 7000, 'شاشة وكاميرا خلفية');
    cost(veh[18], 14, 'insurance', 4200, 'تأمين مؤقت');

    // ---------------------------------------------------------------- customers
    const cust = (name: string, phone: string, national_id: string, address: string, extra: any = {}) =>
      call('customers.create', { name, phone, national_id, address, ...extra }).id;
    const c1 = cust('أحمد محمود السيد', '01001234567', '28501011234567', 'القاهرة - مصر الجديدة', { email: 'ahmed@example.com' });
    const c2 = cust('منى عبد الرحمن', '01112345678', '29003151234568', 'الجيزة - الدقي');
    const c3 = cust('شركة الأفق للتجارة', '0233445566', '51234567', 'القاهرة - التجمع الخامس', { customer_type: 'company' });
    const c4 = cust('محمد حسن إبراهيم', '01223456789', '28807221234569', 'الإسكندرية - سموحة');
    const c5 = cust('ياسر فتحي عبد العزيز', '01534567890', '29211051234570', 'القاهرة - المعادي');
    const c6 = cust('هبة سامي', '01098765432', '29506091234571', 'القاهرة - مدينة نصر');

    // ---------------------------------------------------------------- leads + follow-ups
    const lead = (
      name: string,
      phone: string,
      source: string,
      status: string,
      vehicle_id: number | null,
      interest: string,
      next: string | null,
      customer_id?: number,
    ) =>
      call('leads.create', { name, phone, source, status, vehicle_id, interest, next_follow_up: next, customer_id, assigned_to: uid.sales, budget: M(1500000) })
        .id;
    const l1 = lead('كريم مصطفى', '01005556677', 'facebook', 'interested', veh[6], 'مهتم بـ Chery Tiggo 7 Pro بالتقسيط', d(-2));
    const l2 = lead('نادية فؤاد', '01117778899', 'walk_in', 'negotiating', veh[9], 'تفاوض على سعر Skoda Octavia', T);
    lead('سامح عادل', '01229990011', 'instagram', 'new', null, 'يبحث عن SUV مستعمل حتى 1.3 مليون', d(-1));
    lead('هبة سامي', '01098765432', 'referral', 'reserved', veh[17], 'حجزت Peugeot 3008', null, c6);
    lead('طارق جمال', '01550001122', 'website', 'lost', veh[5], 'فضّل سيارة من معرض آخر', null);
    call('leads.addFollowUp', {
      lead_id: l1,
      follow_date: d(3),
      method: 'call',
      notes: 'تم إرسال عرض سعر بالتقسيط، ينتظر موافقة البنك',
      next_follow_up: d(-2),
    });
    call('leads.addFollowUp', {
      lead_id: l2,
      follow_date: d(1),
      method: 'visit',
      notes: 'زار المعرض وجرب السيارة، يطلب خصم 40 ألف',
      next_follow_up: T,
      status: 'negotiating',
    });

    // ---------------------------------------------------------------- quotations
    call('quotations.create', {
      customer_id: c5,
      vehicle_id: veh[6],
      quote_date: d(4),
      asking_price: M(1450000),
      discount: M(25000),
      payment_method: 'installments',
      down_payment: M(600000),
      months: 24,
      valid_until: d(-10),
      notes: 'عرض خاص شامل التأمين للسنة الأولى',
    });
    call('quotations.create', {
      customer_id: c2,
      vehicle_id: veh[9],
      quote_date: d(2),
      asking_price: M(1960000),
      discount: M(30000),
      payment_method: 'cash',
      valid_until: d(-12),
    });

    // ---------------------------------------------------------------- sales
    const sp = (id: number) => ({ salesperson_id: id });
    // 1. CASH – new Corolla
    call('sales.create', {
      customer_id: c1,
      vehicle_id: veh[0],
      sale_type: 'cash',
      sale_date: d(40),
      list_price: M(1480000),
      discount: M(20000),
      fees: M(15000),
      method: 'bank_transfer',
      reference: 'TRX-88001',
      ...sp(uid.sales),
    });
    // 2. CASH – used Tucson (+ sale-related expense)
    const s2 = call('sales.create', {
      customer_id: c3,
      vehicle_id: veh[10],
      sale_type: 'cash',
      sale_date: d(20),
      list_price: M(1320000),
      discount: M(10000),
      method: 'cheque',
      reference: 'CHQ-45120',
      ...sp(uid.sales2),
    });
    call('expenses.create', {
      expense_date: d(20),
      scope: 'sale',
      sale_id: s2.id,
      category: 'commission',
      description: 'عمولة وسيط البيع',
      amount: M(10000),
      payee: 'وسيط',
    });
    // 3. INSTALLMENTS – equal monthly with down payment (new Sportage)
    const s3 = call('sales.create', {
      customer_id: c4,
      vehicle_id: veh[3],
      sale_type: 'installments',
      sale_date: d(100),
      list_price: M(2090000),
      discount: M(50000),
      down_payment: M(640000),
      plan: { plan_type: 'equal', count: 24, first_due_date: addMonths(d(100), 1) },
      ...sp(uid.sales),
    });
    // pay installments that are due, on time (the 3 due ones)
    const due3 = db.all<any>('SELECT id, due_date, amount FROM installments WHERE contract_id = ? AND due_date <= ? ORDER BY seq', [s3.contract_id, T]);
    due3.forEach((i: any) => call('payments.create', { contract_id: s3.contract_id, amount: i.amount, pay_date: i.due_date, method: 'cash' }));
    // 4. INSTALLMENTS – custom schedule with partial + overdue (used Sunny)
    const s4 = call('sales.create', {
      customer_id: c2,
      vehicle_id: veh[13],
      sale_type: 'installments',
      sale_date: d(75),
      list_price: M(560000),
      down_payment: M(160000),
      plan: {
        plan_type: 'custom',
        lines: [
          { due_date: d(45), amount: M(80000) },
          { due_date: d(15), amount: M(60000) },
          { due_date: d(-15), amount: M(60000) },
          { due_date: d(-45), amount: M(100000) },
          { due_date: d(-75), amount: M(100000) },
        ],
      },
      ...sp(uid.sales2),
    });
    call('payments.create', { contract_id: s4.contract_id, amount: M(80000), pay_date: d(44), method: 'cash' });
    call('payments.create', { contract_id: s4.contract_id, amount: M(25000), pay_date: d(12), method: 'cash', notes: 'دفعة جزئية' }); // partial → overdue
    // 5. TRADE-IN + INSTALLMENTS (balloon) – used Mercedes, customer trades in an Elantra
    const ti = call('tradeins.create', {
      customer_id: c5,
      brand: 'Hyundai',
      model: 'Elantra',
      trim: 'HD',
      model_year: 2016,
      color: 'فضي',
      vin: 'TRDHYU00000016001',
      mileage: 160000,
      condition_grade: 'good',
      condition_notes: 'حالة جيدة، يحتاج دهان جزئي',
      market_value: M(480000),
      trade_in_value: M(440000),
      expected_prep_cost: M(25000),
      expected_selling_price: M(530000),
      eval_date: d(31),
    });
    const s5 = call('sales.create', {
      customer_id: c5,
      vehicle_id: veh[12],
      sale_type: 'trade_in_installments',
      sale_date: d(30),
      list_price: M(2150000),
      discount: M(50000),
      trade_in_id: ti.id,
      down_payment: M(460000),
      plan: { plan_type: 'balloon', count: 12, regular_amount: M(80000), first_due_date: addMonths(d(30), 1) },
      ...sp(uid.sales),
    });
    const firstS5 = db.get<any>('SELECT amount, due_date FROM installments WHERE contract_id = ? ORDER BY seq LIMIT 1', [s5.contract_id]);
    if (firstS5.due_date <= T)
      call('payments.create', {
        contract_id: s5.contract_id,
        amount: firstS5.amount,
        pay_date: firstS5.due_date,
        method: 'bank_transfer',
        reference: 'TRX-99120',
      });
    // trade-in vehicle gets its preparation cost
    call('costs.create', {
      vehicle_id: s5.trade_in_vehicle_id,
      expense_date: d(25),
      category: 'paint',
      amount: M(18000),
      description: 'دهان جزئي',
      supplier_id: workshop,
    });
    call('costs.create', { vehicle_id: s5.trade_in_vehicle_id, expense_date: d(24), category: 'detailing', amount: M(3000), description: 'تنظيف وتلميع' });

    // ---------------------------------------------------------------- reservation (active)
    call('reservations.create', {
      customer_id: c6,
      vehicle_id: veh[17],
      reservation_date: d(2),
      expiry_date: d(-5),
      amount: M(50000),
      agreed_price: M(1180000),
      method: 'cash',
      notes: 'حجز لحين تجهيز باقي المبلغ',
    });

    // ---------------------------------------------------------------- general expenses (3 months)
    for (let m = 0; m < 4; m++) {
      const day = addMonths(T.slice(0, 8) + '01', -m);
      if (day > T) continue;
      call('expenses.create', { expense_date: day, category: 'rent', description: 'إيجار المعرض', amount: M(45000), payment_method: 'bank_transfer' });
      call('expenses.create', {
        expense_date: addDays(day, 1) > T ? day : addDays(day, 1),
        category: 'salaries',
        description: 'رواتب الموظفين',
        amount: M(85000),
        payment_method: 'bank_transfer',
      });
      call('expenses.create', {
        expense_date: addDays(day, 4) > T ? day : addDays(day, 4),
        category: 'electricity',
        description: 'فاتورة الكهرباء',
        amount: M(6500),
      });
      call('expenses.create', {
        expense_date: addDays(day, 6) > T ? day : addDays(day, 6),
        category: 'marketing',
        description: 'إعلانات فيسبوك',
        amount: M(12000),
        payment_method: 'card',
      });
    }
    call('expenses.create', { expense_date: d(3), category: 'office', description: 'أدوات مكتبية وطباعة', amount: M(1800) });

    return {
      vehicles: db.scalar<number>('SELECT COUNT(*) FROM vehicles'),
      customers: db.scalar<number>('SELECT COUNT(*) FROM customers'),
      sales: db.scalar<number>('SELECT COUNT(*) FROM sales'),
    };
  });
}
