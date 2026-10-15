// Browser-tests voor het Budget-scherm (v3.70+). Draait tegen de echte index.html in een iframe,
// met een in-memory Supabase-vervanger (mock-supabase.js) en verzonnen testdata (fixture.js).
// Uitvoeren: serveer de projectmap (python3 -m http.server) en open /tests/run.html.
window.runBudgetTests = async function (w) {
  const results = [];
  // let/const-variabelen van het app-script staan niet op window; lees ze via eval in het iframe.
  const g = name => w.eval(name);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const check = (naam, ok, detail) => results.push({ naam, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const $ = id => w.document.getElementById(id);
  const dbAssigned = (cat, month) => w.__db.budget_months.filter(r => String(r.category_id) === String(cat) && r.month === month).map(r => Number(r.assigned));

  // --- Basis: getallen kloppen met de database ---
  const m = g('budgetModel'), raw = g('budgetRaw');
  const prive = raw.accounts.filter(a => a.scope === 'prive');
  const saldoPrive = prive.reduce((s, a) => s + Number(a.starting_balance), 0) + raw.txns.filter(t => t.date <= raw.todayStr && prive.some(a => String(a.id) === String(t.account_id))).reduce((s, t) => s + Number(t.amount), 0);
  const leaves = raw.cats.filter(c => !raw.cats.some(x => x.parent_id === c.id) && c.id !== 9);
  const rest = id => (m.cumAssignedMap[id] || 0) + (m.cumSpentMap[id] || 0);
  const somPositief = leaves.reduce((s, c) => s + Math.max(0, rest(c.id)), 0);
  check('Klaar om toe te wijzen = saldo privé - som van de positieve categorieën (YNAB-regel)', near(m.rta, saldoPrive - somPositief), `rta=${m.rta} verwacht=${saldoPrive - somPositief}`);
  check('Overschrijding Hobby (€50) is afgetrokken', near(m.rtaBefore - m.rta, 50), m.rtaBefore - m.rta);
  check('Teller zonder categorie = 1 uitgave', m.noCategory === 1, m.noCategory);
  check('Teller wacht op de bank = 1', m.waiting === 1, m.waiting);
  check('Aandacht-kader toont rood, zonder categorie en wacht', ['rood', 'zonder categorie', 'wacht'].every(t => $('budget-attention').innerText.includes(t)));
  check('Hobby is rood en heeft Dek af; Boodschappen niet', !!w.document.querySelector('[data-cover="6"]') && !w.document.querySelector('[data-cover="4"]'));
  check('Groep met rood staat standaard open, groep zonder rood dicht', (() => {
    const st = n => { const h = [...w.document.querySelectorAll('[data-budget-toggle]')].find(e => e.querySelector('.cat-name').textContent.includes(n)); return h && h.dataset.open; };
    return st('Vrije tijd') === '1' && st('Huishouden') === '0';
  })());

  // --- Uitklappen en bedrag aanpassen halen niets opnieuw op ---
  let calls = w.__calls.length;
  click(w.document.querySelector('[data-budget-toggle="3"]'));
  click(w.document.querySelector('[data-expand-toggle="4"]'));
  check('Open- en uitklappen doet geen database-aanvraag', w.__calls.length === calls, w.__calls.length - calls);
  const rtaVoor = m.rta;
  const inp = w.document.querySelector('input.assign[data-cat="4"]');
  inp.value = '450'; inp.dispatchEvent(new w.Event('change', { bubbles: true }));
  calls = w.__calls.length;
  await wait(900);
  const thisMonth = raw.monthStr;
  check('Bedrag wordt opgeslagen in de database', dbAssigned(4, thisMonth)[0] === 450, dbAssigned(4, thisMonth));
  check('Na opslaan geen volledige herlaad van transacties', !w.__calls.slice(calls).includes('transactions'));
  check('Klaar om toe te wijzen daalt met de extra €50', near(g('budgetModel').rta, rtaVoor - 50), g('budgetModel').rta - rtaVoor);

  // --- Dek af ---
  click(w.document.querySelector('[data-cover="6"]'));
  await wait(100);
  check('Dek af opent met het tekort ingevuld (€50)', $('cover-modal-bg').classList.contains('open') && $('cover-amount').value === '50', $('cover-amount').value);
  check('Hobby zelf staat niet in de bronlijst', ![...w.document.querySelectorAll('#cover-source option')].some(o => o.value === '6'));
  click($('cover-save')); await wait(50);
  check('Opslaan zonder bron geeft een melding en schrijft niets', $('cover-error').textContent.includes('Kies') && dbAssigned(6, thisMonth)[0] === 100);
  $('cover-source').value = '7'; $('cover-source').dispatchEvent(new w.Event('change'));
  click($('cover-save')); await wait(400);
  check('Dek af verschuift €50 van Uitgaan naar Hobby', dbAssigned(6, thisMonth)[0] === 150 && dbAssigned(7, thisMonth)[0] === 100, JSON.stringify([dbAssigned(6, thisMonth), dbAssigned(7, thisMonth)]));
  check('Hobby is niet meer rood en Klaar om toe te wijzen steeg met €50', !w.document.querySelector('[data-cover="6"]') && near(g('budgetModel').rta, rtaVoor - 50 + 50), g('budgetModel').rta);

  // --- Bedragen aanpassen (groep) ---
  const grp5 = w.document.querySelector('[data-budget-toggle="5"]');
  if (grp5.dataset.open !== '1') click(grp5); // zonder rood staat de groep dicht; eerst openen
  click(w.document.querySelector('[data-edit-group="5"]'));
  const rows = [...w.document.querySelectorAll('#ba-rows .ba-input')];
  check('Bedragen-scherm toont de categorieën van de groep', rows.length === 2, rows.length);
  rows[0].value = '120';
  click($('ba-save')); await wait(300);
  check('Groepsbewerking slaat alleen het gewijzigde bedrag op', dbAssigned(6, thisMonth)[0] === 120 && dbAssigned(7, thisMonth)[0] === 100, JSON.stringify([dbAssigned(6, thisMonth), dbAssigned(7, thisMonth)]));

  // --- Alleen rood ---
  // Door de groepsbewerking hierboven (Hobby 150 -> 120) is Hobby weer €30 te kort.
  check('Aandacht meldt Hobby opnieuw als rood (-€30)', $('budget-attention').innerText.includes('1 categorie rood'), $('budget-attention').innerText);
  click(w.document.querySelector('[data-attn="red"]'));
  const rijenRood = [...w.document.querySelectorAll('#budget-groups-expense .cat-row')];
  check('Alleen rood toont uitsluitend rode categorieën', rijenRood.length === 1 && !!rijenRood[0].querySelector('[data-cover]'), rijenRood.length);
  click(w.document.querySelector('[data-attn="red"]'));
  check('Nogmaals tikken zet het filter weer uit', !g('budgetOnlyRed'));

  // --- Zonder categorie -> Transacties ---
  click(w.document.querySelector('[data-attn="nocat"]'));
  await wait(800);
  const regels = [...w.document.querySelectorAll('#transactions-list .txn-row')].map(r => r.innerText);
  check('Zonder categorie toont alleen de uitgave zonder categorie', regels.length === 1 && regels[0].includes('Onbekend'), regels.length);
  click($('txn-category-filter-clear'));

  // --- Meer dan 1000 transacties (PostgREST-limiet) ---
  let id = 50000;
  for (let i = 0; i < 2200; i++) w.__db.transactions.push({ id: id++, account_id: 1, category_id: 4, payee: 'x', amount: -1, date: raw.monthStr.slice(0, 8) + '01', cleared: true, notitie: null, link_type: null, linked_transaction_id: null });
  w.document.querySelector('nav button[data-tab="budget"]').click();
  await w.loadBudget();
  check('Alle transacties worden opgehaald, ook boven de 1000', g('budgetRaw').txns.length >= 2200, g('budgetRaw').txns.length);
  return results;
};
