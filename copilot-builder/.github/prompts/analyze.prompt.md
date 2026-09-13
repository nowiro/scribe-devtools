---
description: 'Analyze: raport spójności spec ↔ plan ↔ stan repozytorium przed implementacją — GO albo NO-GO z blockerami (tylko odczyt)'
agent: orchestrator-sdd
---

# /analyze — go / no-go przed implementacją (read-only)

Sprawdź spójność trójki spec ↔ plan ↔ stan repozytorium dla podanego sluga. NIC nie edytuj.

1. Każde AC ma pokrycie w zadaniach planu; każde zadanie planu służy jakiemuś AC.
2. Kolumna `agent` zgodna z tabelą routingu (ścieżka wyznacza właściciela); tier zgodny z rosterem
   (`.github/models-registry.json`) — praca T1 nie siedzi w zadaniach T2.
3. Zgodność ze WSZYSTKIMI ADR-ami z `docs/decisions/` i z `docs/tech-stack.md`; odstępstwo bez ADR-u
   = blocker. ADR `superseded` nie jest podstawą.
4. Standardy UI obecne w planie, gdy zmienia się ekran: matryca viewportów, mobile-first, a11y, stany
   loading / empty / error, `data-testid`.
5. Granice modułów: nowe zależności między bibliotekami zgodne z kierunkiem feature → ui, data-access,
   util (`eslint.rules.mjs`); nowa biblioteka ma typ w nazwie.
6. Otwarte `[?]` w spec albo w planie = automatyczny **NO-GO**.
7. `npm run sdd:check` i `npm run ai:validate` zielone.

Wyjście: `GO` albo `NO-GO + lista blockerów (plik / linia / dlaczego / kto naprawia)`. Zapisz werdykt
w run-logu.
