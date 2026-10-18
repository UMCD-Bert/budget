# Gemeenschappelijke testgegevens (web ↔ native)

`budget-golden.json` bevat **invoer** in de vorm van de Supabase-rijen (verzonnen data, geen echte gegevens) en de
**verwachte uitkomst** van `deriveBudgetModel` in `index.html`.

- Web: `tests/budget.test.js` rekent de invoer door en vergelijkt met `verwacht`.
- Native: `BudgetKern` (`~/Documenten/Xcode/Berts Code Base/Budget`) leest een kopie van dit bestand
  (`Hulpmiddelen/sync-golden.sh`) en moet dezelfde uitkomst geven (`swift test`).

Wijzigt een rekenregel in de webapp (of in Swift), werk dan eerst de uitkomst hier bij en draai beide testsets.
De uitkomst wordt opnieuw gegenereerd door `deriveBudgetModel` in de browser op de invoer los te laten.
