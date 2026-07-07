> 🌐 **Français** · [English version](./GOVERNANCE.en.md)

# Gouvernance

BALDR est un projet open source porté par Malakoff Humanis (MH).
Modèle : **open source sponsorisé** — le développement est ouvert et transparent, tandis que
l'autorité décisionnelle finale reste au sein de l'équipe des mainteneurs MH.

## Rôles

| Rôle | Qui | Droits |
| --- | --- | --- |
| Contributeur | Toute personne | Ouvrir des issues / PR |
| Triager | Contributeur de confiance (réservé pour une ouverture ultérieure) | Trier et étiqueter les issues |
| Committer | Contributeur régulier (réservé pour une ouverture ultérieure) | Fusionner des PR sur un périmètre limité |
| Mainteneur | Employés MH | Fusion, publication, administration du dépôt |
| Lead technique | Vincent RICHARD | Décision finale sur les RFC, départage, vision |

Les rôles Triager et Committer sont définis mais **inactifs au lancement** ; ils seront
ouverts aux contributeurs externes lors de la revue à 12 mois (2027-06-18).

## Prise de décision (fonctionnalités)

Les fonctionnalités non triviales suivent un processus RFC allégé :

1. Ouvrir une issue « Proposition de fonctionnalité » (problème, proposition, alternatives, impact sécurité).
2. Discussion publique, minimum 5 jours ouvrés.
3. Décision : **Lead technique + accord d'au moins 2 mainteneurs**. Les égalités sont tranchées par le Lead technique.
4. La feuille de route MH est priorisée trimestriellement ; les éléments publics portent le label `roadmap`.

Les correctifs mineurs et la documentation ne nécessitent pas de RFC.

## Devenir mainteneur

Une forte contribution n'accorde pas automatiquement le statut de mainteneur. Un parcours de
promotion documenté (Triager → Committer → Mainteneur) s'ouvre lors de la revue à 12 mois,
basé sur la qualité et le volume des PR, la fiabilité des revues, et le respect du Code de conduite.

## Sécurité

Voir [SECURITY.md](./SECURITY.md). Les rapports de vulnérabilités sont validés et triés
en privé par l'équipe SecOps MH via les GitHub Security Advisories.
