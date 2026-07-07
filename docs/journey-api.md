# API Journey — `POST /api/v1/journey`

Lance un **parcours d'audit d'accessibilité** : une séquence de pages, chacune
avec des actions typées (scan, clic, saisie, attente…), exécutées dans l'ordre
par un navigateur headless. Chaque action `scan` déclenche un audit Axe-Core
(enrichi par IA selon `analysisType`) et une capture d'écran.

- **Authentification** : en-tête `X-API-Key` **obligatoire** (voir [README](./README.md#authentification)).
- **Content-Type** de la requête : `application/json`.
- **Réponse** : le rapport généré dans le format demandé (`html`, `json` ou `csv`).

---

## Structure de la requête

```jsonc
{
  "name": "Audit Espace Client",          // optionnel — titre + nom de fichier du rapport
  "options": {                            // optionnel — config d'audit globale
    "analysisType": "full",               // "static" | "intel" | "full" (défaut: "full")
    "reportFormat": "html",               // "html" | "json" | "csv" (défaut: "html")
    "rules": ["1.1", "3.1"],              // optionnel — restreint l'audit à ces règles RGAA
    "viewport": { "width": 1920, "height": 1080 } // optionnel
  },
  "auth": {                               // optionnel — credentials par défaut (omettre = public)
    "username": "jdoe",
    "password": "secret"
  },
  "pages": [                              // OBLIGATOIRE — 1 à 30 pages
    {
      "url": "https://example.com",       // OBLIGATOIRE — http(s), validée anti-SSRF
      "auth": { "username": "jdoe", "password": "secret" }, // optionnel — surcharge l'auth racine
      "actions": [ /* … */ ]              // optionnel — voir « Actions » (0 à 50)
    }
  ]
}
```

### Champs racine

| Champ | Type | Requis | Description |
| --- | --- | --- | --- |
| `name` | `string` | non | Titre de l'audit, utilisé dans le rapport et dans le nom du fichier généré. |
| `options` | `object` | non | Options d'audit appliquées à toutes les pages. |
| `auth` | `{ username, password, loginUrl? }` | non | Identifiants par défaut appliqués à chaque page (voir [Authentification](#authentification-des-pages)). Omettre = pages publiques. |
| `pages` | `Page[]` | **oui** | Liste ordonnée des pages à parcourir (**min 1, max 30**). |

### `options`

| Champ | Type | Défaut | Description |
| --- | --- | --- | --- |
| `analysisType` | `"static" \| "intel" \| "full"` | `"full"` | Profondeur d'analyse appliquée à chaque scan (voir [Types d'analyse](#types-danalyse)). |
| `reportFormat` | `"html" \| "json" \| "csv"` | `"html"` | Format du rapport renvoyé. |
| `rules` | `string[]` | _(toutes)_ | Restreint l'audit à des identifiants de règles RGAA précis (ex. `"1.1"`). |
| `viewport` | `{ width, height }` | _(défaut navigateur)_ | Dimensions de la fenêtre. `width ≥ 320`, `height ≥ 240`. |

### `pages[]`

| Champ | Type | Requis | Description |
| --- | --- | --- | --- |
| `url` | `string` | **oui** | URL à charger (`http(s)://…`), validée contre le SSRF. |
| `auth` | `{ username, password, loginUrl? }` | non | Identifiants propres à cette page ; **surcharge** l'`auth` racine. |
| `actions` | `Action[]` | non | Actions à exécuter (**max 50**). **Si absent ou vide → un scan par défaut** (chargement de la page puis audit). |

---

## Actions

Une action est un **objet typé** discriminé par `type`. Les built-ins
déterministes et les interactions courantes sont validés ; `ai` est la trappe
d'évasion en langage naturel pour les cas non couverts.

| `type` | Champs | Description |
| --- | --- | --- |
| `scan` | — | Lance l'audit d'accessibilité (Axe + IA selon `analysisType`) + capture d'écran. |
| `acceptCookies` | — | Tente d'accepter automatiquement la bannière cookies (Tarteaucitron, Didomi, OneTrust…). |
| `wait` | `ms` (`1`–`60000`) | Pause fixe en millisecondes. |
| `click` | `target` | Clique sur l'élément décrit par `target`. |
| `hover` | `target` | Survole l'élément décrit par `target`. |
| `fill` | `target`, `value` | Saisit `value` dans le champ décrit par `target`. |
| `select` | `target`, `value` | Sélectionne `value` dans la liste décrite par `target`. |
| `ai` | `instruction` | Instruction libre en langage naturel, résolue par l'IA (ex. « ouvrir le sous-menu Fondation »). |

> `target`, `value` et `instruction` sont des chaînes (**max 500 caractères**).
> `target` est une **description en langage naturel** (« le bouton Envoyer »,
> « le champ email ») : l'IA en déduit le sélecteur CSS. Ce n'est pas
> nécessairement un sélecteur.

> ℹ️ Les interactions (`click`, `hover`, `fill`, `select`, `ai`) nécessitent que
> l'IA soit configurée (fournisseur LLM). Les built-ins `scan`, `acceptCookies`
> et `wait` fonctionnent sans IA.

### Exemple d'actions

```json
"actions": [
  { "type": "acceptCookies" },
  { "type": "fill", "target": "le champ email", "value": "user@example.com" },
  { "type": "click", "target": "le bouton Connexion" },
  { "type": "wait", "ms": 1500 },
  { "type": "ai", "instruction": "ouvrir le menu Mon compte" },
  { "type": "scan" }
]
```

---

## Authentification des pages

L'authentification contre le site audité (à ne pas confondre avec la clé d'API)
se déclare **en ligne** avec un seul modèle : **identifiant + mot de passe**. Le
moteur s'adapte tout seul à ce que le site présente (popup native HTTP, ou
formulaire HTML mono‑ ou bi‑étapes). Pas de `type`, pas de `selectors`.

```json
"auth": { "username": "jdoe", "password": "secret" }
```

| Champ | Type | Requis | Description |
| --- | --- | --- | --- |
| `username` | `string` | **oui** | Identifiant (login ou email selon le site). |
| `password` | `string` | **oui** | Mot de passe. |
| `loginUrl` | `string` | non | Page de login à visiter d'abord, si elle diffère de l'URL auditée (auto‑détectée sinon). Validée anti‑SSRF. |

`auth` peut être déclaré :
- au **niveau racine** (`auth`) → défaut appliqué à toutes les pages ;
- **par page** (`pages[].auth`) → surcharge le défaut pour cette page.

**Pas d'authentification** = on **omet** simplement le champ `auth` (page publique).

> **Limite** : un SSO d'entreprise **transparent** (Kerberos/Negotiate, sans
> aucune saisie) ne peut pas être reproduit avec un id+mot de passe depuis une
> machine non jointe au domaine. Dans ce cas, l'audit doit tourner depuis un
> poste joint au domaine ou un environnement réseau adéquat.

---

## Types d'analyse

| `analysisType` | Description |
| --- | --- |
| `static` | Audit Axe-Core uniquement (sans IA) — le plus rapide. |
| `intel` | Audit Axe + analyse IA ciblée. |
| `full` | Audit complet enrichi par IA (défaut) — le plus approfondi. |

---

## Réponse

En cas de succès (`200`), le corps de la réponse est **directement le rapport**
dans le format demandé (ce n'est pas une enveloppe JSON `{ success: … }`).

| En-tête | Valeur |
| --- | --- |
| `Content-Type` | `text/html`, `application/json` ou `text/csv` selon `reportFormat`. |
| `Content-Disposition` | `attachment; filename="<nom>.<ext>"` — `<nom>` dérive du champ `name` (assaini), sinon `rapport-journey`. |

> Comme la réponse HTML porte un `Content-Disposition`, un navigateur la
> **télécharge** au lieu de l'afficher.

### Erreurs

Voir le [contrat d'erreur global](./README.md#format-des-erreurs).

| Code | `error.code` | Cas |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Corps invalide : `pages` manquant/vide, URL invalide ou bloquée (SSRF), action mal typée, > 30 pages, > 50 actions, etc. |
| `401` | `UNAUTHORIZED` | `X-API-Key` manquant ou invalide. |
| `429` | — | Rate limiting dépassé. |
| `500` | `INTERNAL_SERVER_ERROR` | Erreur interne (un `requestId` est inclus). |

---

## Limites

| Limite | Valeur |
| --- | --- |
| Nombre de pages (`pages`) | 1 à 30 |
| Actions par page | 0 à 50 |
| Longueur de `target` / `value` / `instruction` | 500 caractères |
| `wait.ms` | 1 à 60 000 |

---

## Exemples complets

### 1. Audit simple d'une page publique

Une page sans `actions` est auditée par défaut (chargement + scan).

```bash
curl -X POST http://localhost:3000/api/v1/journey \
  -H "X-API-Key: mon-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Page d'\''accueil Wikipedia",
    "options": { "analysisType": "static", "reportFormat": "json" },
    "pages": [ { "url": "https://www.wikipedia.org" } ]
  }'
```

### 2. Parcours avec actions typées et trappe IA

```bash
curl -X POST http://localhost:3000/api/v1/journey \
  -H "X-API-Key: mon-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Parcours formulaire de contact",
    "options": { "analysisType": "full", "reportFormat": "html" },
    "pages": [
      {
        "url": "https://example.com/contact",
        "actions": [
          { "type": "acceptCookies" },
          { "type": "fill", "target": "le champ email", "value": "user@example.com" },
          { "type": "click", "target": "le bouton Envoyer" },
          { "type": "wait", "ms": 1500 },
          { "type": "ai", "instruction": "ouvrir le sous-menu Fondation" },
          { "type": "scan" }
        ]
      }
    ]
  }'
```

### 3. Parcours authentifié multi-pages

L'`auth` racine (identifiant + mot de passe) s'applique par défaut à toutes les
pages.

```bash
curl -X POST http://localhost:3000/api/v1/journey \
  -H "X-API-Key: mon-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Audit pages protégées",
    "options": { "analysisType": "full", "reportFormat": "html" },
    "auth": { "username": "user@example.com", "password": "secret" },
    "pages": [
      { "url": "https://example.com/dashboard" },
      { "url": "https://example.com/mon-compte" }
    ]
  }'
```
