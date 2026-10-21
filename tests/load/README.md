# Tests de charge (k6)

Charge du circuit d envoi des invités (phase 2) : `guests.k6.js`. Données de test dans la base locale, jamais ailleurs.

1. `pnpm db:start` et `pnpm storage:start`.
2. Construire l application puis la démarrer avec le stockage joignable depuis k6 et depuis la machine (avec k6 dans Docker, `host.docker.internal`) :
   `R2_ENDPOINT=http://host.docker.internal:9100 R2_ACCESS_KEY_ID=snapalbum R2_SECRET_ACCESS_KEY=snapalbum-secret R2_BUCKET=snapalbum-load pnpm --filter web exec next start -p 3100` (créer le compartiment `snapalbum-load` sur l émulateur).
3. `node tests/load/prepare.mjs --guests 300 --plan event` (ou `--plan free` pour vérifier que le quota de 200 n est jamais dépassé).
4. `k6 run -e BASE_URL=http://localhost:3100 tests/load/guests.k6.js`.
5. `node tests/load/check.mjs` : quota, compteurs et doublons.

`state.json` (jetons de session) n est pas versionné.
