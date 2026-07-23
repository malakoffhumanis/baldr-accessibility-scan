# Documentation de l'API BALDR

BALDR est une <span lang="en">API</span> d'audit d'accessibilité (RGAA / WCAG) automatisé. Elle pilote
un navigateur <span lang="en">headless</span> (<span lang="en">Puppeteer</span>) pour parcourir un site, exécuter des actions,
puis lancer un audit <span lang="en">Axe-Core</span> enrichi par IA, et produit un rapport
(<span lang="en">HTML</span> / <span lang="en">JSON</span> / <span lang="en">CSV</span>).

## Sommaire

<table>
  <caption>Sommaire de la documentation <span lang="en">API</span></caption>
  <thead>
    <tr>
      <th scope="col">Document</th>
      <th scope="col">Contenu</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="./journey-api.md">journey-api.md</a></td>
      <td><span lang="en">Endpoint</span> principal <code>POST /api/v1/journey</code> : contrat de requête (v3), actions typées, authentification, formats de rapport, exemples.</td>
    </tr>
    <tr>
      <td><a href="./metrics.md">metrics.md</a></td>
      <td><span lang="en">Endpoint</span> <code>GET /metrics</code> : métriques <span lang="en">Prometheus</span> exposées et configuration de scraping.</td>
    </tr>
  </tbody>
</table>

## URL de base

Tous les <span lang="en">endpoints</span> applicatifs sont préfixés par `/api/v1`, **sauf** `/metrics`
qui est exposé à la racine (convention <span lang="en">Prometheus</span>).

```
http://<host>:<PORT>/api/v1
```

`PORT` vaut `3000` par défaut (configurable via la variable d'environnement `PORT`).

## Authentification

L'<span lang="en">API</span> est protégée par **clé d'<span lang="en">API</span> obligatoire**. Chaque requête vers un
<span lang="en">endpoint</span> protégé doit porter l'en-tête :

```
X-API-Key: <secret>
```

- Les clés sont configurées via la variable d'environnement `API_KEYS`
  (format : `id:secret`, séparés par des virgules). Au moins une clé est
  **obligatoire** : l'<span lang="en">API</span> refuse de démarrer sans (pas de mode « ouvert »).
- La comparaison du secret est faite en **temps constant**.
- En cas de clé absente ou invalide : réponse **401**.

<table>
  <caption>Authentification des <span lang="en">endpoints</span></caption>
  <thead>
    <tr>
      <th scope="col"><span lang="en">Endpoint</span></th>
      <th scope="col">Protégé par <code>X-API-Key</code></th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>POST /api/v1/journey</code></td><td>Oui</td></tr>
    <tr><td><code>GET /metrics</code></td><td>Oui</td></tr>
    <tr><td><code>GET /api/v1/health</code></td><td>Non (sonde de vivacité)</td></tr>
    <tr><td><code>GET /api/v1/health/diagnostic</code></td><td>Non</td></tr>
    <tr><td><code>GET /api/v1/docs</code></td><td>Non (exposé seulement si <code>EXPOSE_API_DOCS=true</code>)</td></tr>
  </tbody>
</table>

## Endpoints

<table>
  <caption><span lang="en">Endpoints</span> disponibles</caption>
  <thead>
    <tr>
      <th scope="col">Méthode</th>
      <th scope="col">Chemin</th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>POST</code></td>
      <td><code>/api/v1/journey</code></td>
      <td>Lance un parcours d'audit d'accessibilité multi-pages. Voir <a href="./journey-api.md">journey-api.md</a>.</td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/api/v1/health</code></td>
      <td>Sonde de vivacité (toujours <code>200</code>).</td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/api/v1/health/diagnostic</code></td>
      <td><span lang="en">Diagnostic</span> complet (config + connectivité <span lang="en">LLM</span>). <code>200</code> si sain, <code>503</code> si dégradé.</td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/metrics</code></td>
      <td>Métriques <span lang="en">Prometheus</span>. Voir <a href="./metrics.md">metrics.md</a>.</td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/api/v1/docs</code></td>
      <td>Interface <span lang="en">OpenAPI</span> (si activée).</td>
    </tr>
  </tbody>
</table>

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

<table>
  <caption>Format des erreurs API</caption>
  <thead>
    <tr>
      <th scope="col">Code HTTP</th>
      <th scope="col"><code>error.code</code></th>
      <th scope="col">Cas</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>400</code></td><td><code>VALIDATION_ERROR</code></td><td>Corps de requête invalide (échec de validation du schéma).</td></tr>
    <tr><td><code>401</code></td><td><code>UNAUTHORIZED</code></td><td>En-tête <code>X-API-Key</code> manquant ou invalide.</td></tr>
    <tr><td><code>429</code></td><td>(message texte)</td><td>Trop de requêtes (rate limiting).</td></tr>
    <tr><td><code>500</code></td><td><code>INTERNAL_SERVER_ERROR</code></td><td>Erreur interne (un <code>requestId</code> est inclus dans le message pour le suivi).</td></tr>
  </tbody>
</table>

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
