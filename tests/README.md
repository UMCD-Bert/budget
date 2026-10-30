# Browser-tests

Er is geen Node in de ontwikkelomgeving, dus de tests draaien in de browser tegen de echte `index.html`
met een in-memory Supabase-vervanger en verzonnen testdata (geen echte gegevens).

```bash
python3 -m http.server 8080   # in de projectmap
# open http://localhost:8080/tests/run.html
```

- `mock-supabase.js` — nagebootste client (incl. de 1000-rijen-limiet van PostgREST)
- `fixture.js` — verzonnen rekeningen, categorieën, begroting en transacties relatief aan de huidige maand
- `inzichten.test.js` — Dashboard-inzichten (v3.75): dezelfde verzonnen gegevens en uitkomsten als `InzichtenTests.swift` in de native app
- `budget.test.js` — Budget-scherm: Klaar om toe te wijzen, rood/Aandacht, Dek af, Bedragen aanpassen,
  zonder categorie, paginering, budgetkaart in het transactieformulier

Let op: `let`/`const`-variabelen van de app (zoals `budgetModel`) staan niet op `window`; de tests lezen ze via
`w.eval(...)`. Bij een wijziging aan `index.html`: voeg een test toe en draai de pagina vóór je oplevert.
