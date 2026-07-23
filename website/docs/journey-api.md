# API Journey — `POST /api/v1/journey`

Lance un **parcours d'audit d'accessibilité** : une séquence de pages, chacune
avec des actions typées (<span lang="en">scan</span>, clic, saisie, attente…), exécutées dans l'ordre
par un navigateur <span lang="en">headless</span>. Chaque action `<span lang="en">scan</span>` déclenche un audit <span lang="en">Axe-Core</span>
(enrichi par IA selon `analysisType`) et une capture d'écran.

- **Authentification** : en-tête `X-<span lang="en">API</span>-Key` **obligatoire** (voir [README](./README.md#authentification)).
- **Content-Type** de la requête : `application/<span lang="en">json</span>`.
- **Réponse** : le rapport généré dans le format demandé (`html`, `<span lang="en">json</span>` ou `<span lang="en">csv</span>`).

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

<table>
  <caption>Champs racine de la requete Journey</caption>
  <thead>
    <tr>
      <th scope="col">Champ</th>
      <th scope="col">Type</th>
      <th scope="col">Requis</th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>name</code></td><td><code>string</code></td><td>non</td><td>Titre de l'audit, utilise dans le rapport et dans le nom du fichier genere.</td></tr>
    <tr><td><code>options</code></td><td><code>object</code></td><td>non</td><td>Options d'audit appliquees a toutes les pages.</td></tr>
    <tr><td><code>auth</code></td><td><code>{`{ username, password, loginUrl? }`}</code></td><td>non</td><td>Identifiants par defaut appliques a chaque page (voir <a href="#authentification-des-pages">Authentification</a>). Omettre = pages publiques.</td></tr>
    <tr><td><code>pages</code></td><td><code>Page[]</code></td><td><strong>oui</strong></td><td>Liste ordonnee des pages a parcourir (<strong>min 1, max 30</strong>).</td></tr>
  </tbody>
</table>

### `options`

<table>
  <caption>Options globales de l'audit</caption>
  <thead>
    <tr>
      <th scope="col">Champ</th>
      <th scope="col">Type</th>
      <th scope="col">Defaut</th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>analysisType</code></td><td><code>"static" | "intel" | "full"</code></td><td><code>"full"</code></td><td>Profondeur d'analyse appliquee a chaque <span lang="en">scan</span> (voir <a href="#types-danalyse">Types d'analyse</a>).</td></tr>
    <tr><td><code><span lang="en">reportFormat</span></code></td><td><code>"<span lang="en">html</span>" | "<span lang="en">json</span>" | "<span lang="en">csv</span>"</code></td><td><code>"<span lang="en">html</span>"</code></td><td>Format du rapport renvoye.</td></tr>
    <tr><td><code>rules</code></td><td><code>string[]</code></td><td>(toutes)</td><td>Restreint l'audit a des identifiants de regles RGAA precis (ex. <code>"1.1"</code>).</td></tr>
    <tr><td><code>viewport</code></td><td><code>{`{ width, height }`}</code></td><td>(defaut navigateur)</td><td>Dimensions de la fenetre. <code>width >= 320</code>, <code>height >= 240</code>.</td></tr>
  </tbody>
</table>

### `pages[]`

<table>
  <caption>Champs d'une page dans pages[]</caption>
  <thead>
    <tr>
      <th scope="col">Champ</th>
      <th scope="col">Type</th>
      <th scope="col">Requis</th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>url</code></td><td><code>string</code></td><td><strong>oui</strong></td><td>URL a charger (<code>http(s)://...</code>), validee contre le SSRF.</td></tr>
    <tr><td><code>auth</code></td><td><code>{`{ username, password, loginUrl? }`}</code></td><td>non</td><td>Identifiants propres a cette page ; <strong>surcharge</strong> l'<code>auth</code> racine.</td></tr>
    <tr><td><code>actions</code></td><td><code><span lang="en">Action</span>[]</code></td><td>non</td><td>Actions a executer (<strong>max 50</strong>). <strong>Si absent ou vide : un <span lang="en">scan</span> par defaut</strong> (chargement de la page puis audit).</td></tr>
  </tbody>
</table>

---

## Actions

Une action est un **objet typé** discriminé par `type`. Les <span lang="en">built-ins</span>
déterministes et les interactions courantes sont validés ; `<span lang="en">ai</span>` est la trappe
d'évasion en langage naturel pour les cas non couverts.

<table>
  <caption>Actions supportees</caption>
  <thead>
    <tr>
      <th scope="col"><code>type</code></th>
      <th scope="col">Champs</th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>scan</code></td><td>-</td><td>Lance l'audit d'accessibilite (<span lang="en">Axe</span> + IA selon <code>analysisType</code>) + capture d'ecran.</td></tr>
    <tr><td><code>acceptCookies</code></td><td>-</td><td>Tente d'accepter automatiquement la banniere cookies (Tarteaucitron, Didomi, OneTrust...).</td></tr>
    <tr><td><code><span lang="en">wait</span></code></td><td><code><span lang="en">ms</span></code> (<code>1</code>-<code>60000</code>)</td><td>Pause fixe en millisecondes.</td></tr>
    <tr><td><code><span lang="en">click</span></code></td><td><code><span lang="en">target</span></code></td><td>Clique sur l'element decrit par <code><span lang="en">target</span></code>.</td></tr>
    <tr><td><code><span lang="en">hover</span></code></td><td><code><span lang="en">target</span></code></td><td>Survole l'element decrit par <code><span lang="en">target</span></code>.</td></tr>
    <tr><td><code><span lang="en">fill</span></code></td><td><code><span lang="en">target</span></code>, <code><span lang="en">value</span></code></td><td>Saisit <code><span lang="en">value</span></code> dans le champ decrit par <code><span lang="en">target</span></code>.</td></tr>
    <tr><td><code><span lang="en">select</span></code></td><td><code><span lang="en">target</span></code>, <code><span lang="en">value</span></code></td><td>Selectionne <code><span lang="en">value</span></code> dans la liste decrite par <code><span lang="en">target</span></code>.</td></tr>
    <tr><td><code><span lang="en">ai</span></code></td><td><code><span lang="en">instruction</span></code></td><td><span lang="en">Instruction</span> libre en langage naturel, resolue par l'IA (ex. "ouvrir le sous-menu Fondation").</td></tr>
  </tbody>
</table>

> `<span lang="en">target</span>`, `<span lang="en">value</span>` et `<span lang="en">instruction</span>` sont des chaînes (**max 500 caractères**).
> `<span lang="en">target</span>` est une **description en langage naturel** (" le bouton Envoyer ",
> « le champ <span lang="en">email</span> ») : l'IA en déduit le sélecteur <span lang="en">CSS</span>. Ce n'est pas
> nécessairement un sélecteur.

> ℹ️ Les interactions (`<span lang="en">click</span>`, `<span lang="en">hover</span>`, `<span lang="en">fill</span>`, `<span lang="en">select</span>`, `<span lang="en">ai</span>`) nécessitent que
> l'IA soit configurée (fournisseur <span lang="en">LLM</span>). Les <span lang="en">built-ins</span> `<span lang="en">scan</span>`, `<span lang="en">acceptCookies</span>`
> et `<span lang="en">wait</span>` fonctionnent sans IA.

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
moteur s'adapte tout seul à ce que le site présente (<span lang="en">popup native HTTP</span>, ou
formulaire <span lang="en">HTML</span> mono‑ ou bi‑étapes). Pas de `type`, pas de `selectors`.

```json
"auth": { "username": "jdoe", "password": "secret" }
```

<table>
  <caption>Champs d'authentification du site audite</caption>
  <thead>
    <tr>
      <th scope="col">Champ</th>
      <th scope="col">Type</th>
      <th scope="col">Requis</th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code><span lang="en">username</span></code></td><td><code><span lang="en">string</span></code></td><td><strong>oui</strong></td><td>Identifiant (<span lang="en">login</span> ou <span lang="en">email</span> selon le site).</td></tr>
    <tr><td><code><span lang="en">password</span></code></td><td><code><span lang="en">string</span></code></td><td><strong>oui</strong></td><td>Mot de passe.</td></tr>
    <tr><td><code><span lang="en">loginUrl</span></code></td><td><code><span lang="en">string</span></code></td><td>non</td><td>Page de <span lang="en">login</span> à visiter d'abord, si elle diffère de l'<span lang="en">URL</span> auditée (auto-detéctée sinon). Validée anti-<span lang="en">SSRF</span>.</td></tr>
  </tbody>
</table>

`auth` peut être déclaré :
- au **niveau racine** (`auth`) → défaut appliqué à toutes les pages ;
- **par page** (`pages[].auth`) → surcharge le défaut pour cette page.

**Pas d'authentification** = on **omet** simplement le champ `auth` (page publique).

> **Limite** : un <span lang="en">SSO</span> d'entreprise **transparent** (<span lang="en">Kerberos</span>/<span lang="en">Negotiate</span>, sans
> aucune saisie) ne peut pas être reproduit avec un <span lang="en">id</span>+<span lang="en">mot de passe</span> depuis une
> machine non jointe au domaine. Dans ce cas, l'audit doit tourner depuis un
> poste joint au domaine ou un environnement réseau adéquat.

---

## Types d'analyse

<table>
  <caption>Types d'analyse disponibles</caption>
  <thead>
    <tr>
      <th scope="col"><code>analysisType</code></th>
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>static</code></td><td>Audit <span lang="en">Axe-Core</span> uniquement (sans IA), le plus rapide.</td></tr>
    <tr><td><code>intel</code></td><td>Audit <span lang="en">Axe</span> + analyse IA ciblée.</td></tr>
    <tr><td><code>full</code></td><td>Audit complet enrichi par IA (défaut), le plus approfondi.</td></tr>
  </tbody>
</table>

---

## Réponse

En cas de succès (`200`), le corps de la réponse est **directement le rapport**
dans le format demandé (ce n'est pas une enveloppe <span lang="en">JSON</span> `{ success: … }`).

<table>
  <caption>En-tetes de reponse</caption>
  <thead>
    <tr>
      <th scope="col">En-tete</th>
      <th scope="col">Valeur</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code><span lang="en">Content-Type</span></code></td><td><code><span lang="en">text/html</span></code>, <code><span lang="en">application/json</span></code> ou <code><span lang="en">text/csv</span></code> selon <code><span lang="en">reportFormat</span></code>.</td></tr>
    <tr><td><code>Content-Disposition</code></td><td><code>attachment; filename="&lt;nom&gt;.&lt;ext&gt;"</code> ; <code>&lt;nom&gt;</code> derive du champ <code>name</code> (assaini), sinon <code>rapport-journey</code>.</td></tr>
  </tbody>
</table>

> Comme la réponse HTML porte un `Content-Disposition`, un navigateur la
> **télécharge** au lieu de l'afficher.

### Erreurs

Voir le [contrat d'erreur global](./README.md#format-des-erreurs).

<table>
  <caption>Codes d'erreur</caption>
  <thead>
    <tr>
      <th scope="col">Code</th>
      <th scope="col"><code>error.code</code></th>
      <th scope="col">Cas</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>400</code></td><td><code>VALIDATION_ERROR</code></td><td>Corps invalide : <code>pages</code> manquant/vide, URL invalide ou bloquee (SSRF), action mal typee, &gt; 30 pages, &gt; 50 actions, etc.</td></tr>
    <tr><td><code>401</code></td><td><code>UNAUTHORIZED</code></td><td><code>X-API-Key</code> manquant ou invalide.</td></tr>
    <tr><td><code>429</code></td><td>-</td><td>Rate limiting depasse.</td></tr>
    <tr><td><code>500</code></td><td><code>INTERNAL_SERVER_ERROR</code></td><td>Erreur interne (un <code>requestId</code> est inclus).</td></tr>
  </tbody>
</table>

---

## Limites

<table>
  <caption>Limites techniques</caption>
  <thead>
    <tr>
      <th scope="col">Limite</th>
      <th scope="col">Valeur</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Nombre de pages (<code>pages</code>)</td><td>1 a 30</td></tr>
    <tr><td>Actions par page</td><td>0 a 50</td></tr>
    <tr><td>Longueur de <code>target</code> / <code>value</code> / <code>instruction</code></td><td>500 caracteres</td></tr>
    <tr><td><code>wait.ms</code></td><td>1 a 60 000</td></tr>
  </tbody>
</table>

---

## Exemples complets

### 1. Audit simple d'une page publique

Une page sans `actions` est auditée par défaut (chargement + <span lang="en">scan</span>).

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
