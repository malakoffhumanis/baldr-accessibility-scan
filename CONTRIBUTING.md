> 🌐 **Français** · [English version](./CONTRIBUTING.en.md)

# Contribuer à BALDR

Merci de votre intérêt ! BALDR est porté par Malakoff Humanis.

## Licence des contributions

En proposant une contribution (pull request), vous acceptez qu'elle soit distribuée sous la licence
**Apache-2.0** du projet (entrant = sortant, conformément à la section 5 de la licence Apache-2.0).

## Modèle de branches

Nous utilisons un modèle trunk-based (centré sur `main`) :

- Toutes les pull requests ciblent **`main`**.
- Créez des branches de courte durée nommées selon les types Conventional Commits :
  `feat/*`, `fix/*`, `docs/*`, `chore/*`, `refactor/*`.
- `main` est protégée : pas de push direct, CI verte requise, au moins une
  revue de mainteneur (CODEOWNERS).
- Les publications sont taguées sur `main` via `npm version <patch|minor|major>`.

## Flux de travail

1. Forker le dépôt (ou créer une branche si vous êtes mainteneur).
2. `npm ci`, puis coder. Gardez les changements ciblés.
3. Utiliser les **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`).
4. Exécuter `npm run check` (lint + vérification de types + tests) localement avant de pousser.
5. Ouvrir une PR ciblant `main`. Remplir le modèle de PR.
6. Traiter les retours de revue. Un mainteneur effectue un squash-merge une fois approuvé.

## Proposer une fonctionnalité

Ouvrir une issue « Proposition de fonctionnalité ». Les fonctionnalités non triviales (contrat API, format
de rapport, modèle de sécurité, nouvelle dépendance/fournisseur) suivent le processus RFC dans
[GOVERNANCE.md](./GOVERNANCE.md).

## Code de conduite

Ce projet suit le [Code de conduite](./CODE_OF_CONDUCT.md).
