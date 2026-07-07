/**
 * Zod schemas for API request validation.
 *
 * These are the single source of truth for request payload shapes
 * and runtime constraints. TypeScript types are inferred from schemas.
 */
import './zod-openapi.setup.js';
import { z } from 'zod';

import { validateUrlSsrf } from '@shared/utils/ssrf-guard.util.js';

// ─── Shared sub-schemas ──────────────────────────────────────────────────────

/** URL that passes anti-SSRF validation (blocks private IPs, cloud metadata, non-HTTP). */
const safeUrlSchema = z
  .url()
  .refine((url) => validateUrlSsrf(url) === null, {
    message: 'URL blocked by SSRF protection',
  })
  .openapi({
    description:
      'URL http(s) à charger, validée contre le SSRF (IP privées, métadonnées cloud et schémas non-HTTP bloqués).',
    example: 'https://www.wikipedia.org',
  });

export const analysisTypeSchema = z.enum(['static', 'intel', 'full']).openapi({
  description:
    'Profondeur d\'analyse appliquée à chaque scan : "static" = Axe-Core seul (le plus rapide), "intel" = Axe + analyse IA ciblée, "full" = audit complet enrichi par IA.',
  example: 'full',
});

export const reportFormatSchema = z.enum(['html', 'json', 'csv']).openapi({
  description: 'Format du rapport renvoyé.',
  example: 'html',
});

export const viewportDimensionsSchema = z
  .object({
    width: z.number().int().min(320).openapi({ example: 1920 }),
    height: z.number().int().min(240).openapi({ example: 1080 }),
  })
  .openapi({
    description:
      'Dimensions de la fenêtre du navigateur (width ≥ 320, height ≥ 240).',
  });

// Authentication: credentials only. The engine adapts to whatever the site
// presents (native popup or HTML login form). "No auth" = omit the field.
const authConfigSchema = z
  .object({
    username: z.string().min(1).openapi({
      description: 'Identifiant (login ou email selon le site).',
      example: 'jdoe',
    }),
    password: z.string().min(1).openapi({
      description: 'Mot de passe.',
      example: 'secret',
    }),
    // Optional explicit login page (auto-detected otherwise); SSRF-validated.
    loginUrl: safeUrlSchema.optional().openapi({
      description:
        "Page de login à visiter d'abord si elle diffère de l'URL auditée (auto-détectée sinon). Validée anti-SSRF.",
      example: 'https://en.wikipedia.org/wiki/Special:UserLogin',
    }),
  })
  .openapi({
    description:
      "Identifiants du site audité (à ne pas confondre avec la clé d'API). Le moteur s'adapte au mode présenté (popup HTTP native ou formulaire HTML). Omettre = page publique.",
  });

// ─── Journey schema (v3) ──────────────────────────────────────────────────────

const MAX_PAGES = 30;
const MAX_ACTIONS_PER_PAGE = 50;
const MAX_TARGET_LENGTH = 500;

const targetSchema = z.string().min(1).max(MAX_TARGET_LENGTH).openapi({
  description:
    "Description en langage naturel de l'élément cible (ex. « le bouton Envoyer », « le champ email ») ; l'IA en déduit le sélecteur. Max 500 caractères.",
  example: 'le bouton Connexion',
});
const valueSchema = z.string().max(MAX_TARGET_LENGTH).openapi({
  description: 'Valeur à saisir ou sélectionner. Max 500 caractères.',
  example: 'user@example.com',
});

/**
 * A typed action. Deterministic built-ins + common interactions are
 * first-class; `ai` is the natural-language escape hatch.
 */
const journeyActionSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('scan') }).openapi({
      description:
        "Lance l'audit d'accessibilité (Axe + IA selon analysisType) et une capture d'écran.",
    }),
    z.object({ type: z.literal('acceptCookies') }).openapi({
      description:
        'Tente d’accepter automatiquement la bannière cookies (Tarteaucitron, Didomi, OneTrust…).',
    }),
    z
      .object({
        type: z.literal('wait'),
        ms: z.number().int().min(1).max(60000).openapi({
          description: 'Pause en millisecondes (1 à 60000).',
          example: 1500,
        }),
      })
      .openapi({ description: 'Pause fixe en millisecondes.' }),
    z
      .object({ type: z.literal('click'), target: targetSchema })
      .openapi({ description: "Clique sur l'élément décrit par target." }),
    z
      .object({ type: z.literal('hover'), target: targetSchema })
      .openapi({ description: "Survole l'élément décrit par target." }),
    z
      .object({
        type: z.literal('fill'),
        target: targetSchema,
        value: valueSchema,
      })
      .openapi({
        description: 'Saisit value dans le champ décrit par target.',
      }),
    z
      .object({
        type: z.literal('select'),
        target: targetSchema,
        value: valueSchema,
      })
      .openapi({
        description: 'Sélectionne value dans la liste décrite par target.',
      }),
    z
      .object({
        type: z.literal('ai'),
        instruction: targetSchema.openapi({
          description: 'Instruction libre en langage naturel résolue par IA.',
          example: 'ouvrir le menu Mon compte',
        }),
      })
      .openapi({
        description:
          "Trappe d'évasion : instruction en langage naturel résolue par IA pour les cas non couverts par les actions typées.",
      }),
  ])
  .openapi({
    description:
      'Action typée, discriminée par `type`. Les interactions (click, hover, fill, select, ai) nécessitent un fournisseur LLM ; scan, acceptCookies et wait fonctionnent sans IA.',
  });

const journeyPageSchema = z
  .object({
    url: safeUrlSchema,
    // Inline auth overriding the request-level default.
    auth: authConfigSchema.optional().openapi({
      description:
        "Identifiants propres à cette page ; surcharge l'auth racine.",
    }),
    // Optional: when omitted or empty, the page defaults to a single scan.
    actions: z
      .array(journeyActionSchema)
      .max(
        MAX_ACTIONS_PER_PAGE,
        `"actions" limited to ${String(MAX_ACTIONS_PER_PAGE)} max`,
      )
      .optional()
      .openapi({
        description: `Actions à exécuter dans l'ordre (max ${String(MAX_ACTIONS_PER_PAGE)}). Absent ou vide → un scan par défaut.`,
      }),
  })
  .openapi({ description: 'Page à parcourir et auditer.' });

const journeyOptionsSchema = z
  .object({
    analysisType: analysisTypeSchema.optional(),
    reportFormat: reportFormatSchema.optional(),
    rules: z
      .array(z.string())
      .optional()
      .openapi({
        description:
          "Restreint l'audit à des identifiants de règles RGAA précis (toutes par défaut).",
        example: ['1.1', '3.1'],
      }),
    viewport: viewportDimensionsSchema.optional(),
  })
  .openapi({ description: "Options d'audit appliquées à toutes les pages." });

export const journeyRequestSchema = z
  .object({
    name: z.string().optional().openapi({
      description:
        "Titre de l'audit, utilisé dans le rapport et le nom du fichier généré.",
      example: 'Audit Espace Client',
    }),
    options: journeyOptionsSchema.optional(),
    // Default authentication applied to every page (inline).
    auth: authConfigSchema.optional().openapi({
      description:
        'Identifiants par défaut appliqués à chaque page (surchargés par pages[].auth). Omettre = pages publiques.',
    }),
    pages: z
      .array(journeyPageSchema)
      .min(1, '"pages" must contain at least one page')
      .max(MAX_PAGES, `"pages" limited to ${String(MAX_PAGES)} max`)
      .openapi({
        description: `Liste ordonnée des pages à parcourir (min 1, max ${String(MAX_PAGES)}).`,
      }),
  })
  .openapi({
    description: "Requête d'un parcours d'audit d'accessibilité multi-pages.",
  });

export type ValidatedJourneyRequest = z.infer<typeof journeyRequestSchema>;
