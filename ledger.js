// Motor mensual puro: no guarda cierres como snapshots; los recalcula cada vez.
export const CURRENCIES = ['ARS', 'USD'];
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const FX_DESCRIPTION = /(?:compra|venta) de d[oó]lar(?:es)?(?: oficial)?/i;
export function validMonth(value) { return MONTH_PATTERN.test(String(value || '')); }
export function transactionMonth(value) {
  const m = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:-\d{2})?$/.exec(String(value || ''));
  return m ? m[1] : '';
}
export function shiftMonth(value, steps = 1) {
  if (!validMonth(value)) return '';
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + steps, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function amount(n) { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : 0; }
function balance(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function values(n = 0) { return { ARS: n, USD: n }; }
function fromOpening(opening, field) {
  return {ARS: balance(opening?.[field]?.ARS), USD: balance(opening?.[field]?.USD)};
}
/**
 * El saldo inicial corresponde al inicio del mes ancla y solo se aplica
 * después de que el usuario lo confirma. Los meses anteriores al ancla
 * se ignoran para evitar sumarlos dos veces.
 * Un ahorro mueve dinero entre Disponible y Ahorros, sin ingresos/gastos.
 */
export function buildMonthlyLedger(transactions = [], opening = {}, throughMonth = '') {
  const source = Array.isArray(transactions) ? transactions : [];
  const months = source.map(t => transactionMonth(t.date)).filter(Boolean).sort();
  const confirmed = !!opening.confirmed && validMonth(opening.startMonth);
  const start = confirmed ? opening.startMonth : (months[0] || (validMonth(throughMonth) ? throughMonth : '2026-01'));
  const end = [start, ...months, validMonth(throughMonth) ? throughMonth : ''].filter(Boolean).sort().at(-1);
  const available = confirmed ? fromOpening(opening, 'available') : values();
  const savings = confirmed ? fromOpening(opening, 'savings') : values();
  const grouped = new Map();
  let ignoredBeforeStart = 0;
  for (const t of source) {
    const m = transactionMonth(t.date);
    if (!m || !CURRENCIES.includes(t.currency)) continue;
    if (m < start) { ignoredBeforeStart++; continue; }
    if (!grouped.has(m)) grouped.set(m, []);
    grouped.get(m).push(t);
  }
  const rows = [];
  let cursor = start;
  for (let i = 0; cursor <= end && i < 2400; i++, cursor = shiftMonth(cursor)) {
    const r = {
      month: cursor, confirmed,
      openingAvailable: {...available}, openingSavings: {...savings},
      income: values(), expense: values(), saved: values(), withdrawn: values(),
      exchangeIn: values(), exchangeOut: values(),
      closingAvailable: values(), closingSavings: values(), total: values()
    };
    for (const t of grouped.get(cursor) || []) {
      const c = t.currency, n = amount(t.amount);
      if (!n) continue;
      if (t.savingsAction === 'deposit') {
        available[c] -= n; savings[c] += n; r.saved[c] += n;
      } else if (t.savingsAction === 'withdraw') {
        available[c] += n; savings[c] -= n; r.withdrawn[c] += n;
      } else if (t.internalTransfer) {
        if (FX_DESCRIPTION.test(t.description || '')) {
          if (t.type === 'debit') { available[c] -= n; r.exchangeOut[c] += n; }
          if (t.type === 'credit') { available[c] += n; r.exchangeIn[c] += n; }
        }
      } else if (t.type === 'credit') {
        available[c] += n; r.income[c] += n;
      } else if (t.type === 'debit') {
        available[c] -= n; r.expense[c] += n;
      }
    }
    for (const c of CURRENCIES) {
      available[c] = round(available[c]); savings[c] = round(savings[c]);
      for (const key of ['income','expense','saved','withdrawn','exchangeIn','exchangeOut']) r[key][c] = round(r[key][c]);
      r.closingAvailable[c] = available[c]; r.closingSavings[c] = savings[c];
      r.total[c] = round(available[c] + savings[c]);
    }
    rows.push(r);
  }
  return {rows, startMonth: start, endMonth: end, confirmed, ignoredBeforeStart};
}