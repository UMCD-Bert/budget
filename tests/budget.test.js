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

  // --- Gemeenschappelijke testgegevens met de native app (golden/budget-golden.json) ---
  // Dezelfde invoer en verwachte uitkomst worden in BudgetKern (Swift) gecontroleerd; wijzigt de rekenregel hier,
  // werk dan het bestand bij (zie tests/golden/README.md) en draai ook de Swift-tests.
  {
    const gold = await (await fetch('golden/budget-golden.json?' + Date.now())).json();
    const inv = gold.invoer, verw = gold.verwacht;
    const perId = {}; inv.transacties.forEach(t => { perId[t.id] = t; });
    const eind = '2026-11-01';
    const rawG = { cats: inv.categorieen, monthStr: inv.maand, startStr: inv.maand, endStr: eind, todayStr: inv.vandaag, budgetRows: inv.begroting, txns: inv.transacties,
      splits: inv.splitsingen.map(sp => ({ ...sp, transactions: { date: perId[sp.transaction_id].date } })),
      recurring: inv.herhalend.filter(r => r.active && r.next_date >= inv.maand && r.next_date < eind), accounts: inv.rekeningen, stagingCount: inv.teVerwerkenBankboekingen };
    const mg = w.deriveBudgetModel(rawG);
    const gelijkMap = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => near(a[k] || 0, b[k] || 0));
    check('Golden: toegewezen, besteed en cumulatieven', gelijkMap(mg.assignedMap, verw.toegewezen) && gelijkMap(mg.cumAssignedMap, verw.cumulatiefToegewezen) && gelijkMap(mg.spentMap, verw.besteed) && gelijkMap(mg.cumSpentMap, verw.cumulatiefBesteed) && gelijkMap(mg.expectedMap, verw.verwacht));
    check('Golden: Klaar om toe te wijzen, overschrijding en totaal saldo', near(mg.rta, verw.klaarOmToeTeWijzen) && near(mg.rtaBefore, verw.klaarVoorOverschrijding) && near(mg.overspend, verw.overschrijding) && near(mg.combinedTotal, verw.totaalSaldo), `${mg.rta} / ${verw.klaarOmToeTeWijzen}`);
    check('Golden: tellers (zonder categorie, wacht op bank, te verwerken)', mg.noCategory === verw.zonderCategorie && mg.waiting === verw.wachtOpBank && mg.staging === verw.teVerwerken);

    // v3.78: wat telt als "uitgave zonder categorie". Zelfde gevallen in KernTests.swift (ZonderCategorieTests).
    const typen = [['checking', 9001], ['investment', 9002], ['cash', 9003], ['savings', 9004]];
    const accs = inv.rekeningen.concat(typen.map(([type, id]) => ({ id, name: type, type, scope: 'prive', bank: null, starting_balance: 0 })));
    const tx = (id, acc, extra) => ({ id, account_id: acc, category_id: null, payee: 'Winkel', amount: -10, date: inv.vandaag, cleared: true, link_type: null, ...extra });
    const tel = nieuwe => w.deriveBudgetModel({ ...rawG, accounts: accs, txns: inv.transacties.concat(nieuwe) }).noCategory - mg.noCategory;
    check('Zonder categorie: een gewone uitgave telt', tel([tx(90001, 9001)]) === 1);
    check('Zonder categorie: beleggings-, contant- en spaarrekening tellen niet', tel([tx(90002, 9002), tx(90003, 9003), tx(90004, 9004)]) === 0);
    check('Zonder categorie: "Correctie" telt niet, ook niet in hoofdletters', tel([tx(90005, 9001, { payee: 'Correctie' }), tx(90006, 9001, { payee: ' CORRECTIE ' })]) === 0);
    check('Zonder categorie: bewust zonder categorie telt niet', tel([tx(90007, 9001, { bewust_zonder_categorie: true })]) === 0);
    check('Zonder categorie: overschrijving, inkomst en toekomst tellen niet', tel([tx(90008, 9001, { link_type: 'transfer' }), tx(90009, 9001, { amount: 10 }), tx(90010, 9001, { date: '2099-01-01' })]) === 0);
    check('Zonder categorie: wel Klaar om toe te wijzen: het bedrag gaat er nog steeds van af', near(w.deriveBudgetModel({ ...rawG, accounts: accs, txns: inv.transacties.concat([tx(90011, 9001, { bewust_zonder_categorie: true })]) }).rta, mg.rta - 10));
  }

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

  // --- v3.78: vinkje "Bewust zonder categorie" in het transactieformulier ---
  {
    const bewustZichtbaar = () => $('txn-detail-bewust-wrap').style.display !== 'none';
    await w.openTxnDetail(null);
    $('txn-detail-amount').value = '12'; await wait(700);
    check('Bewust zonder categorie: zichtbaar bij een uitgave zonder categorie', bewustZichtbaar());
    $('txn-detail-bewust').checked = true;
    const l = w.eval('txnDetailLeafOptions').find(x => Number(x.id) === 4);
    $('txn-detail-category-search').value = l.label; await wait(700);
    check('Bewust zonder categorie: verdwijnt (en wordt uitgevinkt) zodra er een categorie is', !bewustZichtbaar() && !$('txn-detail-bewust').checked);
    $('txn-detail-category-search').value = ''; await wait(700);
    click($('txn-detail-type-income')); await wait(700);
    check('Bewust zonder categorie: niet bij een inkomst', !bewustZichtbaar());
    click($('txn-detail-close'));
  }

  // --- v3.79: een nieuwe transactie op een betaalrekening met bankkoppeling begint onbevestigd ---
  {
    const betaal = w.__db.accounts.find(a => a.id === 1), zaak = w.__db.accounts.find(a => a.id === 3);
    const wijzig = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
    const hintZichtbaar = () => $('txn-detail-cleared-hint').style.display !== 'none' && $('txn-detail-cleared-hint').textContent.includes('bankkoppeling');
    check('Bevestigd-standaard: de regel (type + koppeling) staat in één functie', w.defaultClearedForAccount({ type: 'checking', enable_banking_account_uid: 'x' }) === false && w.defaultClearedForAccount({ type: 'checking', enable_banking_account_uid: null }) === true
      && w.defaultClearedForAccount({ type: 'savings', enable_banking_account_uid: 'x' }) === true && w.defaultClearedForAccount(undefined) === true);
    await w.openTxnDetail(null);
    check('Bevestigd-standaard: zonder bankkoppeling staat het vinkje aan, zonder hint', $('txn-detail-cleared').checked && !hintZichtbaar());
    click($('txn-detail-close'));
    betaal.enable_banking_account_uid = 'tst';
    await w.openTxnDetail(null);
    check('Bevestigd-standaard: betaalrekening met bankkoppeling begint onbevestigd, met uitleg', !$('txn-detail-cleared').checked && hintZichtbaar());
    wijzig($('txn-detail-account'), '2');
    check('Bevestigd-standaard: wisselen naar een rekening zonder koppeling zet het vinkje aan', $('txn-detail-cleared').checked && !hintZichtbaar());
    wijzig($('txn-detail-account'), '1');
    check('Bevestigd-standaard: en terug naar de gekoppelde rekening zet het weer uit', !$('txn-detail-cleared').checked && hintZichtbaar());
    $('txn-detail-cleared').checked = true; $('txn-detail-cleared').dispatchEvent(new w.Event('change', { bubbles: true }));
    wijzig($('txn-detail-account'), '2'); wijzig($('txn-detail-account'), '1');
    check('Bevestigd-standaard: een eigen keuze van de gebruiker blijft staan bij het wisselen van rekening', $('txn-detail-cleared').checked);
    click($('txn-detail-close'));
    // Bewerken verandert het vinkje van een bestaande transactie niet.
    const bestaand = w.__db.transactions.find(t => t.account_id === 1 && t.cleared === true);
    await w.openTxnDetail(bestaand.id);
    check('Bevestigd-standaard: een bestaande bevestigde transactie blijft bevestigd bij het bewerken', $('txn-detail-cleared').checked && !hintZichtbaar());
    click($('txn-detail-close'));
    // Zakelijk formulier: zelfde regel.
    zaak.enable_banking_account_uid = 'tst-zak';
    await w.openZakTxnModal();
    check('Bevestigd-standaard: ook het zakelijke formulier begint onbevestigd op een gekoppelde betaalrekening', !$('zak-txn-cleared').checked && $('zak-txn-cleared-hint').style.display !== 'none');
    click($('zak-txn-cancel') || $('zak-txn-modal-bg'));
    delete zaak.enable_banking_account_uid;
    await w.openZakTxnModal();
    check('Bevestigd-standaard: zakelijk zonder koppeling blijft bevestigd', $('zak-txn-cleared').checked && $('zak-txn-cleared-hint').style.display === 'none');
    click($('zak-txn-cancel') || $('zak-txn-modal-bg'));
    delete betaal.enable_banking_account_uid;
  }

  // --- Vaste tabbalk onderaan mag geen inhoud verbergen ---
  w.scrollTo(0, 99999);
  await wait(100);
  const onderkant = [...w.document.querySelectorAll('#tab-budget *')].filter(e => e.offsetParent !== null).reduce((mx, e) => Math.max(mx, e.getBoundingClientRect().bottom), 0);
  check('Onderkant van het Budget-scherm ligt boven de tabbalk', onderkant <= $('app-nav').getBoundingClientRect().top + 0.5, `inhoud ${Math.round(onderkant)} / tabbalk ${Math.round($('app-nav').getBoundingClientRect().top)}`);
  w.scrollTo(0, 0);

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

  // --- Gedeeld kasboek: één ophaalronde voor alle schermen ---
  await wait(800); // laat eerdere, nog lopende laadacties (filter wissen) eerst afronden
  w.eval('invalidateLedger()');
  w.__calls.length = 0;
  await Promise.all([w.loadBudget(), w.loadAccounts(), w.loadTransactions()]);
  const nTxnCalls = w.__calls.filter(t => t === 'transactions').length;
  check('Budget, Rekeningen en Transacties halen samen het kasboek één keer op (+ maandlijst en wachtlijst)', nTxnCalls <= 3, nTxnCalls);
  check('Het kasboek staat daarna in de cache', g('ledgerCache') !== null);
  await w.eval("sb.from('transactions').insert({ account_id: 1, category_id: 4, payee: 'cachetest', amount: -1, date: '" + raw.todayStr + "', cleared: true })");
  check('Een schrijfactie op transacties maakt de cache ongeldig', g('ledgerCache') === null);
  w.eval('invalidateLedger()');
  const nieuw = await w.getLedger();
  check('Daarna bevat het kasboek de nieuwe transactie', nieuw.data.some(t => t.payee === 'cachetest' || (t.amount === -1 && t.category_id === 4)));

  // --- Budgetkaart in het transactieformulier (v3.75) ---
  {
    await w.loadBudget();
    const cardTekst = () => $('txn-detail-budget').style.display === 'none' ? '' : $('txn-detail-budget').innerText;
    const setCat = async id => { const l = w.eval('txnDetailLeafOptions').find(x => Number(x.id) === id); $('txn-detail-category-search').value = l ? l.label : ''; await wait(700); };
    await w.openTxnDetail(null);
    $('txn-detail-amount').value = '20';
    await setCat(4);
    check('Budgetkaart: een uitgave binnen het budget toont "Past in het budget" met de categorie', cardTekst().includes('Boodschappen') && cardTekst().includes('Past in het budget'), cardTekst());
    $('txn-detail-amount').value = '5000'; await wait(700);
    check('Budgetkaart: een te grote uitgave wordt rood met tekort en dekking', cardTekst().includes('Rood') && (cardTekst().includes('Te dekken uit') || cardTekst().includes('Geen enkele')), cardTekst());
    await setCat(null);
    check('Budgetkaart: zonder categorie gaat het van Klaar om toe te wijzen af', cardTekst().includes('Klaar om toe te wijzen'), cardTekst());
    click($('txn-detail-type-income'));
    await setCat(9);
    check('Budgetkaart: een inkomst toont wat er is ontvangen', cardTekst().includes('Inkomsten') && cardTekst().includes('Ontvangen'), cardTekst());
    $('txn-detail-amount').value = ''; await wait(700);
    check('Budgetkaart: zonder bedrag geen kaart', cardTekst() === '');
    click($('txn-detail-close'));
    await wait(700);
    check('Budgetkaart: verdwijnt als het formulier dicht gaat', cardTekst() === '');
    // Een bestaande transactie telt niet dubbel: ongewijzigd laat de kaart dezelfde stand zien als het Budget-scherm.
    await w.openTxnDetail(3);
    await wait(900);
    const mm = g('budgetModel'), restBoodschappen = (mm.cumAssignedMap[4] || 0) + (mm.cumSpentMap[4] || 0);
    check('Budgetkaart: een bestaande transactie wordt niet dubbel geteld', cardTekst().includes('→ ' + w.formatEuroWhole(restBoodschappen)), `${cardTekst()} / verwacht ${restBoodschappen}`);
    click($('txn-detail-close'));
    await wait(400);
  }

  // --- Koppel aan bestaande (bankboeking): datum én bedrag van de bank gaan het formulier in (v3.76) ---
  {
    await w.eval("sb.from('transactions').insert({ account_id: 1, category_id: 4, payee: 'Verwacht abonnement', amount: -135, date: '" + raw.todayStr + "', cleared: false })");
    const verwacht = w.__db.transactions.find(t => t.payee === 'Verwacht abonnement');
    const bankRij = { id: 'stg-koppel', account_id: 1, date: '2026-10-26', amount: -136.84 };
    const houder = w.document.createElement('div');
    houder.innerHTML = '<div class="recon-existing-list" style="display:none"></div>';
    w.document.body.appendChild(houder);
    await w.reconToggleExistingList(bankRij, houder, 'prive');
    const knop = [...houder.querySelectorAll('button')].find(b => b.textContent.includes('Verwacht abonnement'));
    check('Koppel aan bestaande: de onbevestigde transactie staat in de lijst', !!knop);
    if (knop) {
      click(knop);
      await wait(900);
      check('Koppel aan bestaande: het formulier krijgt het bankbedrag, de bankdatum en bevestigd', $('txn-detail-amount').value === '136.84' && $('txn-detail-date').value === '2026-10-26' && $('txn-detail-cleared').checked && w.getAmountType('txn-detail') === 'expense',
        `${$('txn-detail-amount').value} / ${$('txn-detail-date').value} / ${$('txn-detail-cleared').checked}`);
      click($('txn-detail-close'));
      await wait(400);
    }
    houder.remove();
  }

  // --- Bankkaart (v3.80): lijkt de boeking op een bestaande transactie, dan is 'Ja, koppel' de hoofdactie en 'Verwerk als' secundair ---
  {
    await w.eval("sb.from('transactions').insert([{ account_id: 1, category_id: 4, payee: 'Kaarttest', amount: -20, date: '2026-09-01', cleared: true }, { account_id: 1, category_id: 4, payee: 'Kaarttest', amount: -50.25, date: '" + raw.todayStr + "', cleared: false }])");
    w.__db.bank_transactions_staging.push(
      { id: 'kaart-1', account_id: 1, date: raw.todayStr, amount: -50.25, payee: 'Kaarttest', raw_description: 'Kaarttest', processed_at: null },
      { id: 'kaart-2', account_id: 1, date: raw.todayStr, amount: -61.10, payee: 'Kaarttest', raw_description: 'Kaarttest', processed_at: null });
    await w.loadStagingList('prive');
    await wait(300);
    const rijen = [...w.document.querySelectorAll('#bank-recon-list-prive .recon-item')];
    const metKoppel = rijen.find(r => r.querySelector('.recon-link-btn')), zonderKoppel = rijen.find(r => !r.querySelector('.recon-link-btn'));
    check('Bankkaart: bij een gelijkende transactie is Verwerk als secundair (btn-cancel)', !!metKoppel && !!metKoppel.querySelector('.recon-quick-btn.btn-cancel') && !metKoppel.querySelector('.recon-quick-btn.btn-save'), `${rijen.length} rijen`);
    check('Bankkaart: zonder gelijkende transactie blijft Verwerk als de hoofdactie (btn-save)', !!zonderKoppel && !!zonderKoppel.querySelector('.recon-quick-btn.btn-save'), `${rijen.length} rijen`);
    w.__db.bank_transactions_staging.length = 0;
    w.__db.transactions = w.__db.transactions.filter(t => t.payee !== 'Kaarttest');
    w.document.getElementById('bank-recon-list-prive').innerHTML = '';
  }

  // --- Bankkoppelingen: tot wanneer geldt een koppeling, en welke bank is verlopen (v3.77) ---
  {
    check('Koppeling: de naam krijgt de bank erbij, tenzij die er al in staat',
      w.bankAccountLabel({ name: 'Rabo', bank: 'rabobank' }) === 'Rabobank · Rabo' && w.bankAccountLabel({ name: 'Mijn Rabobank', bank: 'rabobank' }) === 'Mijn Rabobank' && w.bankAccountLabel({ name: 'Kas', bank: null }) === 'Kas');
    const accs = [
      { name: 'Rabo', bank: 'rabobank', enable_banking_account_uid: 'a', consent_valid_until: '2026-11-07T10:00:00Z' },
      { name: 'ASN Betaal', bank: 'asn', enable_banking_account_uid: 'b', consent_valid_until: '2026-10-29T10:00:00Z' },
      { name: 'Spaar', bank: 'asn', enable_banking_account_uid: null, consent_valid_until: '2026-10-30T10:00:00Z' },
      { name: 'Oud', bank: 'abnamro', closed: true, enable_banking_account_uid: 'c', consent_valid_until: '2026-10-30T10:00:00Z' },
      { name: 'Later', bank: 'abnamro', enable_banking_account_uid: 'd', consent_valid_until: '2026-11-08T10:00:00Z' }
    ];
    const wr = w.bankExpiryWarnings(accs, '2026-10-31');
    check('Koppeling: waarschuwt vanaf een week en zet de verlopen koppeling bovenaan (niet gekoppeld, gesloten en later: niet)',
      wr.length === 2 && wr[0].label === 'ASN Bank · ASN Betaal' && wr[0].days === -2 && wr[1].label === 'Rabobank · Rabo' && wr[1].days === 7, JSON.stringify(wr));

    // Integratie: banner, Beheer-lijst en de melding bij een verlopen koppeling met de bank erbij.
    const rek = w.__db.accounts.find(a => a.id === 1), oud = { ...rek };
    const over4 = new Date(Date.now() + 4 * 86400000).toISOString();
    Object.assign(rek, { bank: 'rabobank', name: 'Rabo', enable_banking_account_uid: 'u1', consent_valid_until: over4 });
    await w.updateBankLinkStatus();
    check('Koppeling: de banner op het Budget-scherm noemt bank en dagen', $('bank-expiry-banner').innerText.includes('Rabobank · Rabo') && $('bank-expiry-banner').innerText.includes('over 4 dagen'), $('bank-expiry-banner').innerText);
    check('Koppeling: Beheer › Rekeningen toont tot wanneer de koppeling geldt', $('bank-expiry-list').innerText.includes('Rabobank · Rabo: verloopt over 4 dagen'), $('bank-expiry-list').innerText);
    w.eval("Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke: async () => ({ data: { results: [{ account_id: 1, status: 'consent_expired' }] }, error: null }) } })");
    await w.refreshBankReconciliation('prive');
    await wait(300);
    check('Koppeling: de melding bij een verlopen koppeling noemt de bank', $('bank-recon-status-prive').textContent.includes('De koppeling van Rabobank · Rabo is verlopen'), $('bank-recon-status-prive').textContent);
    w.eval("Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke: async () => ({ data: { results: [] }, error: null }) } })");
    Object.assign(rek, oud);
    delete rek.enable_banking_account_uid; delete rek.consent_valid_until;
    await w.updateBankLinkStatus();
    check('Koppeling: zonder koppelingen verdwijnt de banner', $('bank-expiry-banner').innerText.trim() === '');
  }

  // --- Meer dan 1000 transacties (PostgREST-limiet) ---
  let id = 50000;
  for (let i = 0; i < 2200; i++) w.__db.transactions.push({ id: id++, account_id: 1, category_id: 4, payee: 'x', amount: -1, date: raw.monthStr.slice(0, 8) + '01', cleared: true, notitie: null, link_type: null, linked_transaction_id: null });
  w.document.querySelector('nav button[data-tab="budget"]').click();
  w.eval('invalidateLedger()'); // de rijen hierboven zijn rechtstreeks in de nagebootste database gezet
  await w.loadBudget();
  check('Alle transacties worden opgehaald, ook boven de 1000', g('budgetRaw').txns.length >= 2200, g('budgetRaw').txns.length);
  // --- Dashboard: gemeenschappelijke testgegevens met de native app (golden/budget-golden.json) ---
  // Staat als laatste: de database en de klok van het iframe worden hier vervangen door de gemeenschappelijke gegevens.
  {
    const gold = await (await fetch('golden/budget-golden.json?' + Date.now())).json();
    const inv = gold.invoer, dv = gold.verwacht.dashboard;
    window.installMockSupabase(g('sb'), { accounts: inv.rekeningen, categories: inv.categorieen, budget_months: inv.begroting, transactions: inv.transacties,
      transaction_splits: inv.splitsingen, recurring_transactions: inv.herhalend, bank_transactions_staging: [] }, w);
    w.eval(`(function () { const Echt = Date; const vast = new Echt('${inv.vandaag}T12:00:00').getTime();
      window.Date = class extends Echt { constructor(...a) { if (a.length === 0) super(vast); else super(...a); } static now() { return vast; } }; })()`);
    w.eval('invalidateLedger()');
    await w.loadDashboard();
    await w.updateMoneyAge();
    const nu = w.eval('({ maanden: dashAllMonths, inkomsten: dashMonthlyIncome, uitgaven: dashMonthlyExpense, totals: dashCatMonthTotals, leeftijden: dashAgesPerMonth })');
    const gelijkM = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => near(a[k] || 0, b[k] || 0));
    check('Golden dashboard: maanden', JSON.stringify(nu.maanden) === JSON.stringify(dv.maanden), JSON.stringify(nu.maanden));
    check('Golden dashboard: inkomsten en uitgaven per maand', gelijkM(nu.inkomsten, dv.inkomsten) && gelijkM(nu.uitgaven, dv.uitgaven));
    check('Golden dashboard: totalen per categorie per maand', [...new Set([...Object.keys(nu.totals), ...Object.keys(dv.categorieTotalen)])].every(k => gelijkM(nu.totals[k] || {}, dv.categorieTotalen[k] || {})));
    check('Golden dashboard: gemiddelde per categorie (incl. gespreid door de maand)', Object.keys(dv.gemiddelde).every(k => near(w.dashCategoryAverage(k), dv.gemiddelde[k])));
    check('Golden dashboard: Geldleeftijd per maand en nu', JSON.stringify(nu.leeftijden) === JSON.stringify(dv.geldleeftijdPerMaand) && parseInt($('header-money-age').textContent) === dv.geldleeftijdNu, `${JSON.stringify(nu.leeftijden)} / ${$('header-money-age').textContent}`);
    // v3.78: aanwijsbubbel in de grafieken
    {
      const aanwijzen = (el, x = 120, y = 300) => el.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
      const bubbel = () => w.document.querySelector('.chart-tip');
      const zichtbaar = () => !!bubbel() && bubbel().style.display === 'block';
      const hit = sel => w.document.querySelector(sel + ' [data-tip]');
      const alle = sel => w.document.querySelectorAll(sel + ' [data-tip]').length;
      const maanden = nu.maanden.length;
      check('Grafieken: geldleeftijd en inkomsten/uitgaven hebben een aanwijsvlak per maand', alle('#dash-money-age-list') === maanden && alle('#dash-monthly-saldo-list') === maanden, `${alle('#dash-money-age-list')}/${alle('#dash-monthly-saldo-list')}/${maanden}`);
      const h = hit('#dash-monthly-saldo-list');
      aanwijzen(h);
      const tekst = zichtbaar() ? bubbel().innerText : '';
      check('Grafieken: wijzen toont maand, inkomsten, uitgaven en saldo', /\d{4}/.test(tekst) && ['Inkomsten', 'Uitgaven', 'Saldo'].every(t => tekst.includes(t)) && tekst.includes('€'), tekst.replace(/\n/g, ' / '));
      const staaf = h.getAttribute('data-tip').split('|');
      const uit = nu.uitgaven[Object.keys(nu.uitgaven).sort()[0]];
      check('Grafieken: het bedrag in de bubbel komt uit dezelfde gegevens als de grafiek', staaf[0] === w.tipMaand(nu.maanden[0]) && staaf[2] === 'Uitgaven ' + w.formatEuro(Math.abs(uit || 0)), staaf.join(' / '));
      aanwijzen(w.document.body, 5, 5);
      check('Grafieken: buiten een grafiek verdwijnt de bubbel weer', !zichtbaar());
      aanwijzen(hit('#dash-money-age-list'));
      check('Grafieken: geldleeftijd noemt de dagen', zichtbaar() && /Geldleeftijd \d+ dag|Nog geen gegevens/.test(bubbel().innerText), bubbel() && bubbel().innerText);
      const rest = ['#dz-spaar-chart', '#dz-verdeling-body'].filter(sel => w.document.querySelector(sel));
      check('Grafieken: spaarquote en verdeling hebben aanwijsvlakken waar ze getoond worden', rest.every(sel => alle(sel) > 0), rest.join(','));
      const lijnen = w.document.querySelectorAll('#dash-inzichten svg.dash-chart .chart-hit').length;
      check('Grafieken: de inzichten (saldo, vooruitblik, begroot/besteed) hebben aanwijsvlakken', lijnen > 12, lijnen);
      aanwijzen(w.document.body, 5, 5);
    }
  }

  return results;
};
