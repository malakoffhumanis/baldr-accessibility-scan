# Documentation de l'API BALDR

BALDR est une API d'audit d'accessibilité (RGAA / WCAG) automatisé. Elle pilote
un navigateur headless (Puppeteer) pour parcourir un site, exécuter des actions,
puis lancer un audit Axe-Core enrichi par IA, et produit un rapport
(HTML / JSON / CSV).

## Sommaire

| Document | Contenu |
| --- | --- |
| [journey-api.md](./journey-api.md) | Endpoint principal `POST /api/v1/journey` : contrat de requête (v3), actions typées, authentification, formats de rapport, exemples. |
| [metrics.md](./metrics.md) | Endpoint `GET /metrics` : métriques Prometheus exposées et configuration de scraping. |

## URL de base

Tous les endpoints applicatifs sont préfixés par `/api/v1`, **sauf** `/metrics`
qui est exposé à la racine (convention Prometheus).

```
http://<host>:<PORT>/api/v1
```

`PORT` vaut `3000` par défaut (configurable via la variable d'environnement `PORT`).

## Authentification

L'API est protégée par **clé d'API obligatoire**. Chaque requête vers un
endpoint protégé doit porter l'en-tête :

```
X-API-Key: <secret>
```

- Les clés sont configurées via la variable d'environnement `API_KEYS`
  (format : `id:secret`, séparés par des virgules). Au moins une clé est
  **obligatoire** : l'API refuse de démarrer sans (pas de mode « ouvert »).
- La comparaison du secret est faite en **temps constant**.
- En cas de clé absente ou invalide : réponse **401**.

| Endpoint | Protégé par `X-API-Key` |
| --- | --- |
| `POST /api/v1/journey` | ✅ Oui |
| `GET /metrics` | ✅ Oui |
| `GET /api/v1/health` | ❌ Non (sonde de vivacité) |
| `GET /api/v1/health/diagnostic` | ❌ Non |
| `GET /api/v1/docs` | ❌ Non (exposé seulement si `EXPOSE_API_DOCS=true`) |

## Endpoints

| Méthode | Chemin | Description |
| --- | --- | --- |
| `POST` | `/api/v1/journey` | Lance un parcours d'audit d'accessibilité multi-pages. Voir [journey-api.md](./journey-api.md). |
| `GET` | `/api/v1/health` | Sonde de vivacité (toujours `200`). |
| `GET` | `/api/v1/health/diagnostic` | Diagnostic complet (config + connectivité LLM). `200` si sain, `503` si dégradé. |
| `GET` | `/metrics` | Métriques Prometheus. Voir [metrics.md](./metrics.md). |
| `GET` | `/api/v1/docs` | Interface OpenAPI (si activée). |

## Format des erreurs

Toutes les erreurs suivent un contrat unique :

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Description lisible de l'erreur"
  }
}
```

| Code HTTP | `error.code` | Cas |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Corps de requête invalide (échec de validation du schéma). |
| `401` | `UNAUTHORIZED` | En-tête `X-API-Key` manquant ou invalide. |
| `429` | _(message texte)_ | Trop de requêtes (rate limiting). |
| `500` | `INTERNAL_SERVER_ERROR` | Erreur interne (un `requestId` est inclus dans le message pour le suivi). |

## Limitation de débit (rate limiting)

Un quota par IP est appliqué globalement, configuré par les variables
`RATE_LIMIT_WINDOW_MS` (fenêtre en ms) et `RATE_LIMIT_MAX` (nombre de requêtes).
Au dépassement : réponse `429` avec le message
`Too many requests from this IP, please try again later.`

## Sécurité réseau (SSRF)

Toutes les URLs soumises (`pages[].url`, `auth.loginUrl`) sont validées pour
bloquer les requêtes vers des cibles internes (IP privées, `localhost`,
métadonnées cloud `169.254.169.254`, IPv6 loopback/link-local, schémas non
HTTP). Une URL bloquée renvoie une erreur `400`.

## Endpoint de santé

### `GET /api/v1/health`

```json
{
  "success": true,
  "data": { "status": "healthy", "uptime": 1234.5 },
  "metadata": { "timestamp": "2026-06-09T08:00:00.000Z", "version": "1.0.0" }
}
```

### `GET /api/v1/health/diagnostic`

Vérifie la configuration et la connectivité réelle au fournisseur LLM.
Renvoie `200` si `status: "healthy"`, `503` si `status: "degraded"`.

```json
{
  "service": "baldr-api",
  "status": "healthy",
  "timestamp": "2026-06-09T08:00:00.000Z",
  "version": "1.0.0",
  "environment": "production",
  "uptime": 1234.5,
  "checks": {
    "configurationLLM": { "status": "ok", "apiKey": "present", "endpoint": "https://...", "model": "..." },
    "proxy": { "status": "configured", "url": "http://..." },
    "connectivityLLM": { "status": "connected" },
    "configuration": { "port": 3000, "env": "production", "browserHeadless": true }
  }
}
```
