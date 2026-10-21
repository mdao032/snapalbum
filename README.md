# Snapalbum

Les invités d'un événement envoient leurs photos et vidéos dans un album partagé en scannant un QR code, sans appli ni compte. L'organisateur récupère, modère et télécharge l'album.

Snapalbum est un nom provisoire, défini dans `packages/shared/src/brand.ts`.

## Démarrage en 5 commandes

Prérequis : Node.js 22+, pnpm 12, Git, Docker (voir [docs/setup.md](docs/setup.md)).

```bash
git clone https://github.com/mdao032/snapalbum && cd snapalbum
pnpm install
cp .env.example apps/web/.env.local   # puis remplacer les valeurs fictives
pnpm dev
```

Le site est sur http://localhost:3000 (français) et http://localhost:3000/en (anglais).

## Organisation

```
apps/web         Next.js : site, espace organisateur, page invité, routes API
apps/mobile      appli Expo (phase 7)
packages/shared  marque, offres, schémas Zod, client d'API, file d'attente, traductions
packages/config  configurations partagées (TypeScript, ESLint, Prettier)
supabase         migrations SQL et données de départ
docs             décisions, journal, installation, tests manuels, RGPD
```

## Commandes

| Commande                       | Rôle                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `pnpm dev`                     | Serveur de développement                               |
| `pnpm lint` / `pnpm typecheck` | Lint et vérification des types                         |
| `pnpm test`                    | Tests unitaires (Vitest)                               |
| `pnpm test:db`                 | Tests de sécurité de la base (Docker)                  |
| `pnpm test:e2e`                | Tests bout en bout (Playwright, Supabase local requis) |
| `pnpm build`                   | Build de production                                    |
| `pnpm format`                  | Formatage Prettier                                     |

## Documents de référence

- [SPEC.md](SPEC.md) : cahier des charges
- [ROADMAP.md](ROADMAP.md) : plan de réalisation par phases
- [CLAUDE.md](CLAUDE.md) : règles de travail
- [docs/setup.md](docs/setup.md) : installation pas à pas
- [docs/decisions.md](docs/decisions.md) : décisions techniques
