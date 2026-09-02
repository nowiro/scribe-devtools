# bench/app — strona benchu

`index.html` to statyczna kopia `packages/browser-inspector/fixtures/form.html` — odbicie formularza
`demo/app` ze scribe (ten sam zestaw `data-testid`, ta sama walidacja, ten sam `POST /api/zgloszenia`
kończący się 404 widocznym wyłącznie w konsoli). Repozytorium scribe nie ma zbudowanego `dist`
Angulara (a budowanie go wymagałoby `npm install` w cudzym drzewie), więc bench jedzie na tej kopii;
serwuje ją `bench/serve.mjs` na porcie 4300. Obie strony pomiaru (bi i MCP) widzą ten sam plik.
