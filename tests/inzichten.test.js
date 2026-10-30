// Tests voor de Dashboard-inzichten (v3.75). Dezelfde verzonnen gegevens en verwachte uitkomsten als BudgetKern/Tests/BudgetKernTests/InzichtenTests.swift:
// web en native app moeten hier hetzelfde uitrekenen. "Vandaag" staat vast op 15 oktober 2026.
window.runInzichtenTests = function (w) {
  const results = [];
  const check = (naam, ok, detail) => results.push({ naam, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const near = (a, b, e = 0.01) => Math.abs(a - b) < e;

  const T = (id, account_id, category_id, payee, amount, date) => ({ id, account_id, category_id, payee, amount, date, cleared: true, link_type: null });
  function basis({ herhalend = [], extra = [], teVerwerken = 0, zonderZakelijk = false } = {}) {
    const C = (id, parent_id, name, type, spread) => ({ id, parent_id, name, type: type || null, sort_order: id, scope: 'prive', spread_through_month: !!spread });
    const rows = [
      [2, '2026-10-01', 400], [3, '2026-10-01', 300], [3, '2026-09-01', 300], [3, '2026-08-01', 300],
      [8, '2026-10-01', 100], [8, '2026-09-01', 100], [8, '2026-08-01', 100]
    ].map(([category_id, month, assigned], i) => ({ id: i + 1, category_id, month, assigned }));
    return {
      todayStr: '2026-10-15',
      accounts: [{ id: 1, scope: 'prive', starting_balance: 1000 }].concat(zonderZakelijk ? [] : [{ id: 4, scope: 'zakelijk', starting_balance: 0 }]),
      cats: [C(1, null, 'Huishouden', 'expense'), C(2, 1, 'Boodschappen', null, true), C(3, 1, 'Uitgaan'), C(6, 1, 'Hobby'), C(4, null, 'Inkomen', 'income'), C(5, 4, 'Salaris'),
             C(7, null, 'Sparen', 'reservation'), C(8, 7, 'Vakantie')],
      budgetRows: rows, splits: [], recurring: herhalend, stagingCount: teVerwerken,
      txns: [T(1, 1, 5, 'Werkgever', 3000, '2026-08-01'), T(2, 1, 5, 'Werkgever', 3000, '2026-09-01'), T(3, 1, 5, 'Werkgever', 3000, '2026-10-01'),
             T(4, 1, 3, 'Café', -100, '2026-08-10'), T(5, 1, 3, 'Café', -100, '2026-09-10'), T(6, 1, 3, 'Café', -200, '2026-10-10'),
             T(7, 1, 2, 'Jumbo', -288, '2026-10-05'), T(8, 1, 6, 'Bouwmarkt', -60, '2026-10-07'), T(9, 1, 8, 'Camping', -90, '2026-08-20'),
             T(20, 4, null, 'Klant', 1000, '2026-09-05'), T(21, 4, null, 'Leverancier', -400, '2026-10-05'), T(22, 4, null, 'Klant', 500, '2026-10-08')].concat(extra)
    };
  }
  const R = (payee, amount, frequency, next_date, category_id = 3, active = true) => ({ account_id: 1, category_id, payee, amount, frequency, next_date, active });
  const d = o => w.deriveDashInzichten(basis(o));

  let i = d({ teVerwerken: 3 });
  check('Inzichten: aandacht telt rood (Hobby zonder budget) en te verwerken', i.aandacht.roodAantal === 1 && near(i.aandacht.roodSom, 60) && i.aandacht.teVerwerken === 3 && !i.aandacht.isLeeg, JSON.stringify(i.aandacht));

  i = d();
  const tb = i.tempo.find(t => t.naam === 'Boodschappen');
  check('Inzichten: tempo ziet Boodschappen als te snel (595 tegenover 400), Uitgaan niet gespreid', i.heeftGespreid && tb && tb.status === 'teSnel' && tb.beschikbaar === 400 && tb.uitgegeven === 288 && tb.verwacht > 590 && tb.verwacht < 600 && !i.tempo.some(t => t.naam === 'Uitgaan'), JSON.stringify(tb));
  const gu = i.gewoonte.find(g => g.naam === 'Uitgaan');
  check('Inzichten: gewoonte vergelijkt met voorgaande maanden (200 tegenover gemiddeld 100)', gu && gu.dezeMaand === 200 && gu.gemiddeld === 100 && gu.verschil === 100, JSON.stringify(gu));
  check('Inzichten: "Dit valt op" meldt Uitgaan 100% hoger', i.opvallend.some(o => o.soort === 'letOp' && o.tekst.includes('Uitgaan') && o.tekst.includes('100%')), JSON.stringify(i.opvallend));

  i = d({ extra: [T(40, 1, 6, 'Jaarpremie', -400, '2026-08-03')] });
  check('Inzichten: een onregelmatige uitgave is geen gewoonte', !i.gewoonte.some(g => g.naam === 'Hobby') && !i.opvallend.some(o => o.tekst.includes('Hobby')));

  i = d({ extra: [T(30, 1, 3, 'Nieuwe zaak', -150, '2026-10-12')] });
  check('Inzichten: nieuwe naam en grootste uitgave', i.opvallend.some(o => o.soort === 'nieuw' && o.tekst.includes('Nieuwe zaak')) && i.opvallend.some(o => o.soort === 'info' && o.tekst.includes('Jumbo')), JSON.stringify(i.opvallend));

  i = d({ extra: [T(31, 1, 3, 'Telecom', -20, '2026-08-03'), T(32, 1, 3, 'Telecom', -20, '2026-09-03'), T(33, 1, 3, 'Telecom', -25, '2026-10-03')] });
  check('Inzichten: een vast bedrag dat verandert wordt gemeld', i.opvallend.some(o => o.tekst.includes('Telecom steeg')), JSON.stringify(i.opvallend));

  i = d({ herhalend: [R('Sportclub', -50, 'monthly', '2026-10-20')] });
  const v = i.vooruitblik;
  check('Inzichten: vooruitblik start op het saldo en loopt 90 dagen', v && v.punten.length === 90 && near(v.start, 9162) && v.punten[0].dag === '2026-10-16' && v.punten[89].dag === '2027-01-13', v && JSON.stringify([v.punten.length, v.start, v.punten[0].dag, v.punten[89].dag]));
  check('Inzichten: vooruitblik toont de herhalende betaling en rekent met uitgaven, niet met toevallige inkomsten', v.komend.some(b => b.naam === 'Sportclub' && b.bedrag === -50) && v.gemiddeldPerDag < 0 && v.laagste.dag === v.punten[89].dag);

  i = d({ herhalend: [R('Sportclub', -120, 'yearly', '2026-12-01'), R('Verzekering', -90, 'monthly', '2026-10-20'), R('Werkgever', 3000, 'monthly', '2026-11-01', 5), R('Oud', -999, 'monthly', '2026-11-01', 3, false)] });
  const vl = i.vasteLasten;
  check('Inzichten: vaste lasten per maand/jaar, inkomsten en aandeel', near(vl.perMaand, 100) && near(vl.perJaar, 1200) && vl.vasteInkomstenPerMaand === 3000 && vl.posten[0].naam === 'Verzekering' && vl.posten.length === 2 && near(vl.aandeel, 100 / 3000, 0.0001), JSON.stringify(vl));

  i = d();
  const doel = i.doelen.find(x => x.naam === 'Vakantie');
  check('Inzichten: doel Vakantie (saldo 210, 100 p/m, streef 90, voortgang vol)', doel && doel.saldo === 210 && near(doel.perMaand, 100) && doel.streef === 90 && doel.klaarOp === null && doel.voortgang === 1, JSON.stringify(doel));
  const vm = i.verdeling.dezeMaand, vj = i.verdeling.ditJaar;
  check('Inzichten: verdeling deze maand 548, grootste winkel Jumbo; dit jaar 838 (met reservering)', vm.totaal === 548 && vm.delen[0].naam === 'Huishouden' && vm.winkels[0].naam === 'Jumbo' && vm.winkels[0].bedrag === 288 && vj.totaal === 838 && near(vm.delen.reduce((s, x) => s + x.aandeel, 0), 1, 0.001), JSON.stringify([vm.totaal, vj.totaal]));
  const okt = i.spaarquote.maanden[i.spaarquote.maanden.length - 1], aug = i.spaarquote.maanden.find(m => m.maand === '2026-08');
  check('Inzichten: spaarquote oktober (lopend) en augustus', okt.lopend && okt.maand === '2026-10' && near(okt.quote, (3000 - 548) / 3000, 0.001) && near(aug.quote, (3000 - 190) / 3000, 0.001) && i.spaarquote.gemiddelde !== null);
  const bb = i.begrootBesteed[i.begrootBesteed.length - 1];
  check('Inzichten: begroot 800 tegenover besteed 548, niet over budget, wel iets rood', bb.lopend && bb.begroot === 800 && bb.besteed === 548 && !bb.overBudget && bb.roodAantal >= 1, JSON.stringify(bb));
  const z = i.zakelijk, zo = z && z.maanden[z.maanden.length - 1];
  check('Inzichten: zakelijk resultaat (jaar 1100, oktober +100, beste maand september)', z && near(z.ditJaar, 1100) && zo.inkomsten === 500 && zo.uitgaven === -400 && zo.resultaat === 100 && z.beste.maand === '2026-09-01', JSON.stringify(z));
  check('Inzichten: zonder zakelijke rekening geen zakelijk blok', d({ zonderZakelijk: true }).zakelijk === null);
  check('Inzichten: maandsaldi privé/zakelijk/samen lopen tot nu', (() => { const m = i.maandsaldi, l = m[m.length - 1]; return l.maand === '2026-10' && near(l.prive, 9162) && near(l.zakelijk, 1100) && near(l.totaal, 10262); })(), JSON.stringify(i.maandsaldi.slice(-1)));
  return results;
};
