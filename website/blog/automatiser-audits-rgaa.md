---
slug: automatiser-audits-rgaa
title: Comment automatiser les audits RGAA avec BALDR
description: Découvrez comment automatiser les audits RGAA et WCAG avec BALDR Accessibility Scan.
keywords:
  - RGAA
  - WCAG
  - audit accessibilité
  - accessibility testing
  - a11y
  - Intelligence artificielle
tags:
  - RGAA
  - WCAG
  - Accessibilité
  - Scan IA RGGA
date: 2026-07-10
---

# Comment automatiser les audits RGAA avec BALDR

L'accessibilité numérique est devenue un enjeu majeur pour les organisations publiques et privées. Pourtant, réaliser un **audit RGAA** ou un **audit WCAG** de manière manuelle peut rapidement devenir coûteux et chronophage, en particulier sur des applications riches comportant plusieurs parcours utilisateurs.

**BALDR Accessibility Scan** permet d'automatiser les audits d'accessibilité web afin de détecter rapidement les problèmes de conformité, de réduire les régressions et d'intégrer l'accessibilité dans les processus de développement et de déploiement.

## Pourquoi automatiser les audits RGAA ?

Le **Référentiel Général d'Amélioration de l'Accessibilité (RGAA)** impose de nombreux contrôles permettant d'évaluer l'accessibilité des sites web et applications numériques.

Une vérification manuelle complète présente plusieurs limites :

- Temps de réalisation important
- Difficulté à répéter les contrôles à chaque livraison
- Risque de régression entre deux versions
- Coût élevé des audits récurrents
- Détection tardive des défauts d'accessibilité

L'automatisation permet de mettre en place une démarche d'amélioration continue et de contrôler l'accessibilité à chaque étape du cycle de développement.

## Les limites des scanners d'accessibilité traditionnels

La majorité des outils de **web accessibility testing** se concentrent sur l'analyse d'une page unique.

Cette approche montre rapidement ses limites lorsque l'application contient :

- Des parcours utilisateurs multi-pages
- Des espaces authentifiés
- Des formulaires complexes
- Des interactions dynamiques JavaScript
- Des workflows métiers
- Des tableaux de bord réservés aux utilisateurs connectés

Or, ces zones représentent souvent la partie la plus importante d'une application métier ou d'un espace client.

## Comment BALDR automatise les audits d'accessibilité

BALDR combine plusieurs technologies afin de réaliser des audits d'accessibilité automatisés plus avancés :

### Analyse des règles d'accessibilité

BALDR s'appuie sur **axe-core**, l'un des moteurs d'analyse d'accessibilité les plus utilisés dans l'écosystème web.

Cette analyse permet notamment de détecter :

- Les images sans texte alternatif
- Les problèmes de contraste
- Les erreurs de structure HTML
- Les défauts de navigation clavier
- Les violations WCAG les plus courantes

### Navigation automatisée

Grâce à **Puppeteer** et **Chromium**, BALDR peut :

- Naviguer sur plusieurs pages
- Cliquer sur des éléments interactifs
- Remplir des formulaires
- Gérer les bandeaux cookies
- Parcourir des applications dynamiques

### Analyse enrichie par Intelligence Artificielle

BALDR peut également utiliser un fournisseur LLM compatible OpenAI afin :

- d'interpréter des instructions en langage naturel ;
- de localiser automatiquement des éléments à l'écran ;
- d'enrichir les résultats des audits ;
- de proposer des recommandations de remédiation plus exploitables.

## Installation

Le package est publié sur npm et fournit deux binaires :

- `baldr` : mode CLI
- `baldrd` : mode API

Installation :

```bash
npm install -g baldr-accessibility-scan
```

Prérequis :

- Node.js 22 ou supérieur
- Chromium (installé automatiquement via Puppeteer)

Vérification :

```bash
baldr --version
baldr run --help
```

## Réaliser un audit RGAA en 30 secondes

### Via la ligne de commande

L'exemple suivant lance un audit d'accessibilité sur la page d'accueil de Wikipédia :

```bash
echo '{ "pages": [ { "url": "https://www.wikipedia.org" } ] }'   | baldr run --format html -o rapport.html
```

Le rapport généré contient :

- Les violations détectées
- Le score de conformité
- Les recommandations de correction
- Les exportations HTML, JSON ou CSV

### Via l'API

Démarrer le serveur :

```bash
API_KEYS=demo:mon-secret baldrd
```

Puis lancer l'audit :

```bash
curl -X POST http://localhost:3000/api/v1/journey   -H "X-API-Key: mon-secret"   -H "Content-Type: application/json"   -d '{ "pages": [ { "url": "https://www.wikipedia.org" } ] }'
```

## Cas d'usage

BALDR est particulièrement adapté pour :

- L'audit RGAA automatisé
- Les audits WCAG continus
- Les tests d'accessibilité dans les pipelines CI/CD
- Les applications nécessitant une authentification
- Les espaces clients et intranets
- Les plateformes SaaS
- Les sites institutionnels
- Les applications métiers complexes

## Conclusion

L'automatisation des audits d'accessibilité constitue aujourd'hui un levier essentiel pour maintenir la conformité RGAA et WCAG dans le temps.

Grâce à son approche combinant **axe-core**, **Puppeteer**, **API REST**, **parcours utilisateurs multi-pages** et **analyse enrichie par Intelligence Artificielle**, BALDR permet aux équipes techniques d'intégrer l'accessibilité directement dans leurs processus de développement, de validation et de déploiement.

Pour les organisations souhaitant industrialiser leurs contrôles d'accessibilité, BALDR offre une solution open source capable d'analyser les applications modernes, y compris les espaces authentifiés et les parcours utilisateurs complexes.
