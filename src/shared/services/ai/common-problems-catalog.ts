import type { ICommonProblem } from '@shared/types/audit.types.js';

/** Fiches "problèmes communs" indexées par ID de règle Axe-Core (top 15 règles fréquentes). */
export const AXE_RULE_CATALOG: Record<string, Omit<ICommonProblem, never>> = {
  'color-contrast': {
    title: 'Contraste de couleur insuffisant',
    severity: 'serious',
    rgaaCriteria: ['3.2', '3.3'],
    wcagReferences: ['1.4.3 (AA)', '1.4.11 (AA)'],
    description:
      "Plusieurs éléments textuels ou composants d'interface présentent un ratio de contraste insuffisant entre le texte et son arrière-plan. Le ratio minimum requis est de 4.5:1 pour le texte normal et 3:1 pour le texte agrandi. Ce défaut rend les textes difficiles à lire pour les personnes ayant une déficience visuelle ou des troubles de la vision des couleurs.",
    recommendation:
      'Vérifier et corriger le contraste de tous les éléments textuels avec un outil tel que le Contrast Checker de WebAIM. Privilégier des couleurs sombres sur fond clair (ou inversement) pour atteindre au moins 4.5:1.',
    codeExample:
      '/* ❌ Contraste insuffisant */\n.text-secondary { color: #999999; }   /* ratio ~2.8:1 sur fond blanc */\n\n/* ✅ Contraste suffisant */\n.text-secondary { color: #595959; }   /* ratio ~7:1 sur fond blanc */',
  },

  'image-alt': {
    title: 'Images sans alternative textuelle pertinente',
    severity: 'serious',
    rgaaCriteria: ['1.1', '1.2', '1.3'],
    wcagReferences: ['1.1.1 (A)'],
    description:
      "Plusieurs images informatives n'ont pas d'attribut alt (alt absent), ont un alt vide (alt=\"\"), ou un alt non pertinent (nom de fichier, mot-clé technique). Un alt absent ou vide sur une image porteuse d'information est une violation : elle ne doit jamais être considérée comme décorative. Les utilisateurs de lecteurs d'écran ne peuvent alors pas accéder à l'information. À l'inverse, certaines images purement décoratives possèdent un alt renseigné qui crée du bruit sonore inutile.",
    recommendation:
      'Pour chaque image : si elle est informative, ajouter un alt qui décrit son contenu de manière concise ; si elle est purement décorative, utiliser alt="" pour qu\'elle soit ignorée par les technologies d\'assistance.',
    codeExample:
      '<!-- ❌ Image informative sans alt -->\n<img src="/photo-equipe.jpg">\n\n<!-- ✅ Image informative avec alt descriptif -->\n<img src="/photo-equipe.jpg" alt="Équipe au complet devant les locaux du siège">\n\n<!-- ✅ Image décorative correctement ignorée -->\n<img src="/decor-vague.svg" alt="" role="presentation">',
  },

  label: {
    title: 'Champs de formulaire sans étiquette accessible',
    severity: 'critical',
    rgaaCriteria: ['11.1', '11.2'],
    wcagReferences: ['1.3.1 (A)', '3.3.2 (A)', '4.1.2 (A)'],
    description:
      'Plusieurs champs de saisie ne sont pas associés à une étiquette via un <label for="…"> ni via aria-label/aria-labelledby. Les lecteurs d\'écran ne peuvent pas annoncer la fonction du champ, rendant les formulaires inutilisables pour les utilisateurs aveugles ou malvoyants.',
    recommendation:
      'Associer chaque champ à une étiquette explicite. Privilégier <label for="id"> pour le visible ; utiliser aria-label uniquement quand l\'étiquette ne peut pas être affichée à l\'écran.',
    codeExample:
      '<!-- ❌ Champ sans label -->\n<input type="email" placeholder="Email">\n\n<!-- ✅ Champ avec label associé -->\n<label for="email">Adresse e-mail</label>\n<input type="email" id="email" name="email">',
  },

  'link-name': {
    title: 'Liens sans intitulé explicite',
    severity: 'serious',
    rgaaCriteria: ['6.1', '6.2'],
    wcagReferences: ['2.4.4 (A)', '2.4.9 (AAA)'],
    description:
      'Plusieurs liens ne possèdent pas d\'intitulé textuel ou utilisent des intitulés génériques ("En savoir plus", "Cliquez ici", "Voir"). Les utilisateurs de lecteurs d\'écran qui naviguent par liste de liens entendent une succession d\'intitulés identiques sans pouvoir distinguer leur destination.',
    recommendation:
      "Rendre chaque lien explicite hors contexte. Si l'intitulé visuel ne peut pas être modifié, utiliser aria-label pour fournir une alternative descriptive.",
    codeExample:
      '<!-- ❌ Lien non explicite -->\n<a href="/article/123">En savoir plus</a>\n\n<!-- ✅ Lien explicite (texte visible) -->\n<a href="/article/123">En savoir plus sur la nouvelle gamme</a>\n\n<!-- ✅ Lien explicite via aria-label -->\n<a href="/article/123" aria-label="En savoir plus sur la nouvelle gamme">En savoir plus</a>',
  },

  'button-name': {
    title: 'Boutons sans intitulé accessible',
    severity: 'critical',
    rgaaCriteria: ['7.1', '11.1'],
    wcagReferences: ['4.1.2 (A)'],
    description:
      "Plusieurs boutons (souvent des boutons-icônes : fermer, menu, recherche) n'ont pas de texte accessible ni d'aria-label. Les lecteurs d'écran annoncent simplement \"bouton\" sans indiquer sa fonction, rendant l'action impossible pour les utilisateurs aveugles.",
    recommendation:
      "Ajouter un texte visible ou un aria-label décrivant l'action du bouton. Pour les boutons-icônes, l'aria-label est obligatoire.",
    codeExample:
      '<!-- ❌ Bouton-icône sans label -->\n<button><svg>...</svg></button>\n\n<!-- ✅ Bouton-icône avec aria-label -->\n<button aria-label="Fermer la fenêtre">\n  <svg aria-hidden="true">...</svg>\n</button>',
  },

  'heading-order': {
    title: 'Hiérarchie des titres incohérente',
    severity: 'serious',
    rgaaCriteria: ['9.1'],
    wcagReferences: ['1.3.1 (A)', '2.4.6 (AA)'],
    description:
      "Les pages présentent des sauts dans la hiérarchie des titres HTML (par ex. <h1> suivi directement de <h3> sans <h2>). Les lecteurs d'écran utilisent les titres comme principal moyen de navigation ; un saut de niveau brise cette structure et empêche de comprendre l'organisation logique du contenu.",
    recommendation:
      'Respecter une hiérarchie strictement descendante sans saut. Un seul <h1> par page décrivant le contenu principal, puis <h2> pour les sections, <h3> pour les sous-sections, etc.',
    codeExample:
      '<!-- ❌ Saut de niveau interdit -->\n<h1>Titre principal</h1>\n  <h3>Sous-section</h3>   <!-- saute h2 -->\n\n<!-- ✅ Hiérarchie correcte -->\n<h1>Titre principal</h1>\n  <h2>Section</h2>\n    <h3>Sous-section</h3>',
  },

  region: {
    title: 'Contenu hors landmark sémantique',
    severity: 'moderate',
    rgaaCriteria: ['9.2', '12.6'],
    wcagReferences: ['1.3.1 (A)', '2.4.1 (A)'],
    description:
      "Du contenu significatif se trouve en dehors de tout landmark (<main>, <header>, <nav>, <footer>, <aside>). Les utilisateurs de technologies d'assistance qui naviguent par régions ne peuvent pas atteindre ces zones, ce qui les rend invisibles pour eux.",
    recommendation:
      'Encapsuler tout contenu significatif dans un landmark sémantique. Veiller à ce que <main>, <header>, <footer> soient au premier niveau du <body>, jamais imbriqués.',
    codeExample:
      '<!-- ✅ Structure de landmarks correcte -->\n<body>\n  <header role="banner">...</header>\n  <nav aria-label="Navigation principale">...</nav>\n  <main role="main">\n    <!-- contenu principal ici -->\n  </main>\n  <footer role="contentinfo">...</footer>\n</body>',
  },

  'document-title': {
    title: 'Titre de page identique sur plusieurs pages',
    severity: 'serious',
    rgaaCriteria: ['8.6'],
    wcagReferences: ['2.4.2 (A)'],
    description:
      "Le <title> est identique sur plusieurs pages du site. C'est la première information annoncée par les lecteurs d'écran au chargement ; un titre identique empêche les utilisateurs de distinguer les pages, de retrouver un onglet et de comprendre l'étape en cours du journey.",
    recommendation:
      "Donner à chaque page un titre unique reflétant son contenu, idéalement avec le nom de l'application en suffixe.",
    codeExample:
      '<!-- ❌ Titre identique sur toutes les pages -->\n<title>Mon Application</title>\n\n<!-- ✅ Titre unique par page -->\n<title>Tableau de bord — Mon Application</title>\n<title>Profil utilisateur — Mon Application</title>',
  },

  'html-has-lang': {
    title: 'Attribut lang manquant ou incorrect sur <html>',
    severity: 'serious',
    rgaaCriteria: ['8.3'],
    wcagReferences: ['3.1.1 (A)'],
    description:
      "L'attribut lang n'est pas renseigné sur la balise <html> ou contient une valeur invalide. Les lecteurs d'écran ont besoin de cette information pour utiliser la bonne synthèse vocale (français, anglais, etc.) ; sans elle, le contenu peut être prononcé avec un accent inadapté qui le rend incompréhensible.",
    recommendation:
      'Ajouter l\'attribut lang sur <html> avec un code de langue valide (ex. "fr", "fr-FR", "en").',
    codeExample:
      '<!-- ❌ Manque l\'attribut lang -->\n<html>\n\n<!-- ✅ Lang renseigné -->\n<html lang="fr">',
  },

  'aria-required-attr': {
    title: 'Attributs ARIA requis manquants',
    severity: 'serious',
    rgaaCriteria: ['7.1'],
    wcagReferences: ['4.1.2 (A)'],
    description:
      'Plusieurs éléments avec un rôle ARIA (par ex. role="checkbox", role="slider") manquent des attributs ARIA obligatoires associés (aria-checked, aria-valuenow, etc.). Le rôle est annoncé mais l\'état de l\'élément reste inconnu pour les utilisateurs de lecteurs d\'écran.',
    recommendation:
      'Pour chaque rôle ARIA utilisé, vérifier la spécification WAI-ARIA et ajouter les attributs requis. Privilégier les éléments HTML natifs (<input type="checkbox">) qui n\'ont pas besoin d\'ARIA.',
    codeExample:
      '<!-- ❌ Rôle ARIA sans état -->\n<div role="checkbox">Activer les notifications</div>\n\n<!-- ✅ Rôle ARIA complet -->\n<div role="checkbox" aria-checked="false" tabindex="0">Activer les notifications</div>\n\n<!-- ✅ Mieux : élément natif -->\n<label><input type="checkbox"> Activer les notifications</label>',
  },

  'aria-valid-attr-value': {
    title: 'Valeurs ARIA invalides',
    severity: 'serious',
    rgaaCriteria: ['7.1'],
    wcagReferences: ['4.1.2 (A)'],
    description:
      'Plusieurs attributs ARIA contiennent des valeurs invalides (ex. aria-expanded="yes" au lieu de "true", aria-labelledby pointant vers un id inexistant). Les lecteurs d\'écran ignorent ces attributs malformés, supprimant l\'information qu\'ils devaient porter.',
    recommendation:
      "Vérifier la spécification WAI-ARIA pour chaque attribut. Les booléens prennent 'true' ou 'false' (en chaîne). Les références d'id (aria-labelledby, aria-describedby) doivent pointer vers des éléments existants dans le DOM.",
    codeExample:
      '<!-- ❌ Valeur invalide -->\n<button aria-expanded="yes">Menu</button>\n\n<!-- ✅ Valeur valide -->\n<button aria-expanded="false">Menu</button>',
  },

  list: {
    title: 'Listes mal structurées',
    severity: 'moderate',
    rgaaCriteria: ['9.3'],
    wcagReferences: ['1.3.1 (A)'],
    description:
      "Plusieurs <ul>/<ol> contiennent autre chose que des <li> en enfant direct (ex. des <div> intermédiaires) ou inversement plusieurs <li> orphelins sans parent <ul>/<ol>. Les lecteurs d'écran ne peuvent pas annoncer correctement le nombre d'items ni permettre une navigation rapide entre eux.",
    recommendation:
      'Vérifier que chaque <ul>/<ol> ne contient que des <li> en enfants directs et que tout <li> a bien un parent <ul> ou <ol>.',
    codeExample:
      '<!-- ❌ Wrapper non autorisé entre ul et li -->\n<ul>\n  <div class="wrapper">\n    <li>Item 1</li>\n  </div>\n</ul>\n\n<!-- ✅ Structure conforme -->\n<ul class="wrapper">\n  <li>Item 1</li>\n</ul>',
  },

  'duplicate-id': {
    title: 'Identifiants HTML dupliqués',
    severity: 'serious',
    rgaaCriteria: ['8.2'],
    wcagReferences: ['4.1.1 (A)'],
    description:
      "Plusieurs éléments du DOM partagent le même attribut id. Les références (label[for], aria-labelledby, aria-describedby, ancres internes) deviennent ambiguës et certains technologies d'assistance ne ciblent que la première occurrence, créant des associations incorrectes.",
    recommendation:
      'Garantir l\'unicité de tous les attributs id dans une page. Pour des éléments répétés, utiliser des classes ou des id générés (id="user-123") plutôt que des id statiques.',
    codeExample:
      '<!-- ❌ Id dupliqués -->\n<input id="email">\n<input id="email">  <!-- duplicate -->\n\n<!-- ✅ Id uniques -->\n<input id="email-billing">\n<input id="email-shipping">',
  },

  'frame-title': {
    title: 'Iframes sans titre accessible',
    severity: 'serious',
    rgaaCriteria: ['2.1', '2.2'],
    wcagReferences: ['2.4.1 (A)', '4.1.2 (A)'],
    description:
      "Plusieurs <iframe> ne possèdent pas d'attribut title. Les utilisateurs de lecteurs d'écran ne peuvent pas comprendre le contenu intégré (formulaire externe, lecteur vidéo, plan, etc.) avant de devoir y entrer.",
    recommendation:
      'Ajouter un attribut title sur chaque <iframe> qui décrit son contenu de manière concise.',
    codeExample:
      '<!-- ❌ iframe sans titre -->\n<iframe src="https://maps.example.com/embed/123"></iframe>\n\n<!-- ✅ iframe avec titre descriptif -->\n<iframe src="https://maps.example.com/embed/123" title="Carte interactive du siège social"></iframe>',
  },

  bypass: {
    title: "Absence de lien d'évitement",
    severity: 'serious',
    rgaaCriteria: ['12.7'],
    wcagReferences: ['2.4.1 (A)'],
    description:
      "La page ne propose pas de mécanisme permettant de sauter les blocs répétitifs (en-tête, navigation) pour atteindre directement le contenu principal. Les utilisateurs naviguant au clavier ou avec un lecteur d'écran doivent parcourir l'ensemble de ces éléments sur chaque page.",
    recommendation:
      "Ajouter un lien d'évitement en tout début de page, visible au focus clavier, pointant vers la zone <main>.",
    codeExample:
      '<body>\n  <!-- ✅ Lien d\'évitement en premier -->\n  <a href="#main-content" class="skip-link">Aller au contenu principal</a>\n  <header>...</header>\n  <main id="main-content">\n    <!-- contenu principal -->\n  </main>\n</body>\n\n<style>\n.skip-link { position: absolute; left: -9999px; }\n.skip-link:focus { left: 0; top: 0; padding: 12px; background: #0066cc; color: #fff; }\n</style>',
  },
};

/** Mapping ruleId IA RGAA → clé Axe pour réutiliser le catalogue. */
const AI_RULE_TO_AXE_KEY: Record<string, string> = {
  'image-alt': 'image-alt',
  'image-text': 'image-alt',
  'image-decorative': 'image-alt',
  'image-alt-relevance': 'image-alt',
  'frame-title': 'frame-title',
  'frame-title-relevance': 'frame-title',
  'form-labels': 'label',
  'form-required-fields': 'label',
  'form-error-messages': 'label',
  'link-purpose': 'link-name',
  'mandatory-lang-attribute': 'html-has-lang',
  'structure-heading-hierarchy': 'heading-order',
  'heading-hierarchy': 'heading-order',
  'structure-list-usage': 'list',
  'navigation-systems': 'bypass',
  'presentation-color-contrast': 'color-contrast',
  'color-contrast': 'color-contrast',
};

interface IRecurringRule {
  id: string;
  pageCount: number;
  occurrences: number;
  description?: string;
  rgaaTags?: string[];
  wcagTags?: string[];
}

/** Fallback générique pour une règle absente du catalogue. */
function buildGenericProblem(rule: IRecurringRule): ICommonProblem {
  const rgaa = (rule.rgaaTags ?? [])
    .map((t) => t.replace(/^RGAA-?v?\d?-?/i, ''))
    .filter(Boolean);
  const wcag = (rule.wcagTags ?? [])
    .filter((t) => /^wcag\d/.test(t))
    .map((t) => t.replace(/^wcag/, '').replace(/^(\d)(\d{2,3})$/, '$1.$2'));

  return {
    title:
      rule.description ?? `Règle d'accessibilité "${rule.id}" non respectée`,
    severity: 'moderate',
    rgaaCriteria: rgaa,
    wcagReferences: wcag,
    description:
      `Cette règle d'accessibilité (${rule.id}) est violée sur ${String(rule.pageCount)} pages auditées avec ${String(rule.occurrences)} occurrences au total. ${rule.description ?? ''}`.trim(),
    recommendation: `Consulter la documentation de la règle "${rule.id}" pour identifier la correction adaptée. La récurrence indique un problème de patron (composant ou template partagé).`,
  };
}

/** Préfixe la description avec le nombre de pages affectées. */
function withPagesPrefix(
  base: ICommonProblem,
  rule: IRecurringRule,
  totalPages: number,
): ICommonProblem {
  const pagesText = `🔁 Présent sur ${String(rule.pageCount)} / ${String(totalPages)} pages auditées${
    rule.occurrences > 0
      ? ` (${String(rule.occurrences)} occurrences au total)`
      : ''
  }. À vérifier et corriger.`;
  return {
    ...base,
    description: `${pagesText}\n\n${base.description}`,
  };
}

/** Construit le squelette ICommonProblem[] depuis les règles récurrentes (≥ 2 pages). */
export function buildBaselineProblems(
  recurringAxe: IRecurringRule[],
  recurringAi: IRecurringRule[],
  totalPages: number,
): ICommonProblem[] {
  const seen = new Set<string>();
  const out: ICommonProblem[] = [];

  const lookup = (key: string, rule: IRecurringRule): ICommonProblem => {
    const entry: ICommonProblem | undefined = AXE_RULE_CATALOG[key];

    return entry ? { ...entry } : buildGenericProblem(rule);
  };

  for (const rule of recurringAxe) {
    if (seen.has(rule.id)) continue;
    out.push(withPagesPrefix(lookup(rule.id, rule), rule, totalPages));
    seen.add(rule.id);
  }

  for (const rule of recurringAi) {
    const axeKey = AI_RULE_TO_AXE_KEY[rule.id] ?? rule.id;
    if (seen.has(axeKey)) continue;
    out.push(withPagesPrefix(lookup(axeKey, rule), rule, totalPages));
    seen.add(axeKey);
  }

  return out;
}

/** Extrait le premier objet JSON valide (tolère markdown et texte d'intro). */
export function extractFirstJsonObject(text: string): string | null {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
