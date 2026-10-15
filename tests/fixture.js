// Verzonnen testdata (geen echte gegevens) relatief aan de huidige maand, zodat de tests altijd "deze maand" zijn.
window.makeBudgetFixture = function () {
  const now = new Date();
  const ym = (offset) => { const d = new Date(now.getFullYear(), now.getMonth() + offset, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const thisMonth = ym(0) + '-01', lastMonth = ym(-1) + '-01';
  const day = (n) => ym(0) + '-' + String(Math.min(n, now.getDate() || 1)).padStart(2, '0');
  const categories = [
    { id: 1, parent_id: null, name: 'Wonen', type: 'expense', sort_order: 0, scope: 'prive' },
    { id: 2, parent_id: 1, name: 'Huur', type: 'expense', sort_order: 0, scope: 'prive' },
    { id: 3, parent_id: null, name: 'Huishouden', type: 'expense', sort_order: 1, scope: 'prive' },
    { id: 4, parent_id: 3, name: 'Boodschappen', type: 'expense', sort_order: 0, scope: 'prive' },
    { id: 5, parent_id: null, name: 'Vrije tijd', type: 'expense', sort_order: 2, scope: 'prive' },
    { id: 6, parent_id: 5, name: 'Hobby', type: 'expense', sort_order: 0, scope: 'prive' },
    { id: 7, parent_id: 5, name: 'Uitgaan', type: 'expense', sort_order: 1, scope: 'prive' },
    { id: 8, parent_id: null, name: 'Inkomen', type: 'income', sort_order: 3, scope: 'prive' },
    { id: 9, parent_id: 8, name: 'Salaris', type: 'expense', sort_order: 0, scope: 'prive' },
    { id: 10, parent_id: null, name: 'Auto', type: 'reservation', sort_order: 4, scope: 'prive' },
    { id: 11, parent_id: 10, name: 'Onderhoud', type: null, sort_order: 0, scope: 'prive' }
  ];
  const accounts = [
    { id: 1, name: 'Betaal', type: 'checking', scope: 'prive', bank: 'asn', starting_balance: 1000 },
    { id: 2, name: 'Spaar', type: 'savings', scope: 'prive', bank: null, starting_balance: 5000 },
    { id: 3, name: 'Zaak', type: 'checking', scope: 'zakelijk', bank: 'abnamro', starting_balance: 200 }
  ];
  // Eerder bijgekomen: Hobby is vorige maand al €50 te kort uitgegeven.
  const budget_months = [
    { id: 1, category_id: 2, month: thisMonth, assigned: 800 }, { id: 2, category_id: 4, month: thisMonth, assigned: 400 },
    { id: 3, category_id: 6, month: thisMonth, assigned: 100 }, { id: 4, category_id: 7, month: thisMonth, assigned: 150 },
    { id: 5, category_id: 9, month: thisMonth, assigned: 3000 }, { id: 6, category_id: 11, month: thisMonth, assigned: 200 },
    { id: 7, category_id: 6, month: lastMonth, assigned: 100 }, { id: 8, category_id: 11, month: lastMonth, assigned: 300 }
  ];
  const T = (id, account_id, category_id, payee, amount, date, cleared = true, link_type = null) => ({ id, account_id, category_id, payee, amount, date, cleared, notitie: null, link_type, linked_transaction_id: null });
  const transactions = [
    T(1, 1, 9, 'Werkgever', 3000, day(1)), T(2, 1, 2, 'Verhuurder', -800, day(1)),
    T(3, 1, 4, 'Supermarkt', -120, day(2)), T(4, 1, 6, 'Hobbywinkel', -250, day(3)),
    T(5, 1, 7, 'Café', -40, day(3)), T(6, 1, null, 'Onbekend', -35, day(2)),
    T(7, 1, 4, 'Supermarkt', -30, day(2), false)
  ];
  return { accounts, categories, budget_months, transactions, transaction_splits: [], recurring_transactions: [], bank_transactions_staging: [] };
};
