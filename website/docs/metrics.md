# Métriques — `GET /metrics`

Expose les métriques applicatives et système au **format Prometheus** (texte).
Destiné au scraping par un serveur Prometheus pour l'observabilité (volumétrie,
latences, consommation LLM, audits en cours).

- **Chemin** : `/metrics` (à la **racine**, hors préfixe `/api/v1`, par convention Prometheus).
- **Authentification** : en-tête `X-API-Key` **obligatoire** (même système que le reste de l'API). Sans clé valide → `401`.
- **Content-Type** : `text/plain; version=0.0.4` (format d'exposition Prometheus).
- **Rate limiting** : soumis au quota global par IP (comme les autres endpoints).

---

## Métriques exposées

### Métriques système (Node.js)

Collectées automatiquement avec le **préfixe `baldr_`** : latence de l'event
loop, usage du tas (heap), garbage collection, descripteurs de fichiers, etc.
(métriques standard `prom-client`, ex. `baldr_process_cpu_seconds_total`,
`baldr_nodejs_eventloop_lag_seconds`, …).

### Métriques applicatives

<table>
  <caption>Metriques applicatives exposees</caption>
  <thead>
    <tr>
      <th scope="col">Metrique</th>
      <th scope="col">Type</th>
      <th scope="col">Labels</th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>baldr_llm_calls_total</code></td><td>Counter</td><td><code>model</code>, <code>status</code></td><td>Nombre total d'appels a l'API LLM.</td></tr>
    <tr><td><code>baldr_llm_call_duration_seconds</code></td><td>Histogram</td><td><code>model</code></td><td>Duree des appels LLM (buckets : 0.5, 1, 2, 5, 10, 30, 60, 120, 180 s).</td></tr>
    <tr><td><code>baldr_llm_tokens_total</code></td><td>Counter</td><td><code>model</code>, <code>type</code></td><td>Nombre total de tokens consommes (<code>type</code> = prompt/completion).</td></tr>
    <tr><td><code>baldr_llm_cache_hits_total</code></td><td>Counter</td><td><code>source</code></td><td>Nombre de hits du cache LLM (<code>source</code> = LRU ou replay).</td></tr>
    <tr><td><code>baldr_audit_requests_total</code></td><td>Counter</td><td><code>status</code>, <code>apiKey</code></td><td>Nombre total de requetes d'audit. <code>apiKey</code> = identifiant <strong>public</strong> de la cle (jamais le secret), ou <code>anonymous</code>.</td></tr>
    <tr><td><code>baldr_audit_duration_seconds</code></td><td>Histogram</td><td>-</td><td>Duree des requetes d'audit completes (buckets : 5, 10, 30, 60, 120, 300, 600 s).</td></tr>
    <tr><td><code>baldr_active_audits</code></td><td>Gauge</td><td>-</td><td>Nombre d'audits actuellement en cours.</td></tr>
  </tbody>
</table>

> Le label `apiKey` n'expose que l'**identifiant public** de la clé (la partie
> `id` de `API_KEYS`), jamais le secret — cardinalité bornée.

---

## Exemple de réponse

```bash
curl -s http://localhost:3000/metrics -H "X-API-Key: mon-secret"
```

```text
# HELP baldr_audit_requests_total Total audit requests
# TYPE baldr_audit_requests_total counter
baldr_audit_requests_total{status="success",apiKey="client-a"} 12

# HELP baldr_active_audits Number of currently running audits
# TYPE baldr_active_audits gauge
baldr_active_audits 1

# HELP baldr_llm_call_duration_seconds Duration of LLM API calls in seconds
# TYPE baldr_llm_call_duration_seconds histogram
baldr_llm_call_duration_seconds_bucket{le="0.5",model="..."} 0
...
```

---

## Configuration du scraping Prometheus

Comme `/metrics` exige l'en-tête `X-API-Key`, il faut l'injecter dans la
configuration du job de scraping :

```yaml
scrape_configs:
  - job_name: baldr
    metrics_path: /metrics
    scheme: http
    static_configs:
      - targets: ['baldr-host:3000']
    http_headers:
      X-API-Key:
        values: ['<un-secret-de-API_KEYS>']
```

> Selon la version de Prometheus, l'injection d'en-têtes custom peut nécessiter
> un reverse proxy intermédiaire si `http_headers` n'est pas disponible.

### Alternative : réseau interne

Si le scraping passe par un réseau déjà cloisonné, vous pouvez préférer
restreindre l'accès à `/metrics` au niveau réseau (ACL ingress) plutôt que par
clé d'API. Dans la configuration actuelle, la protection par `X-API-Key` est
néanmoins **toujours active**.
