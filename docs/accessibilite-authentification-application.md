# Comment auditer l'accessibilité d'une application authentifiée ?

## Le défi des applications authentifiées

La majorité des outils d'**audit d'accessibilité web** et de **tests d'accessibilité automatisés** se limitent à l'analyse de pages publiques.

Pourtant, les fonctionnalités les plus critiques se trouvent souvent dans :

- les espaces clients ;
- les intranets d'entreprise ;
- les applications métiers ;
- les portails RH ;
- les extranets ;
- les plateformes SaaS ;
- les back-offices administratifs.

Ces zones représentent généralement la plus grande partie du parcours utilisateur réel et sont souvent soumises aux mêmes exigences de conformité **RGAA** et **WCAG** que les sites publics.

## Les limites des scanners d'accessibilité traditionnels

Les outils d'accessibilité classiques rencontrent plusieurs difficultés lorsqu'ils doivent analyser des applications sécurisées :

- authentification préalable requise ;
- parcours utilisateurs multi-pages ;
- interactions dynamiques JavaScript ;
- formulaires complexes ;
- contenus chargés après connexion ;
- workflows métier spécifiques.

Par conséquent, une grande partie des problèmes d'accessibilité peut rester invisible lors d'un audit limité aux seules pages publiques.

## Comment BALDR facilite les audits d'applications authentifiées

BALDR Accessibility Scan permet d'automatiser l'audit des espaces sécurisés grâce à :

✅ l'authentification automatique ;

✅ la navigation dans des parcours utilisateurs complets ;

✅ l'analyse de plusieurs pages au cours d'un même audit ;

✅ l'automatisation des interactions utilisateur ;

✅ l'évaluation de la conformité RGAA et WCAG sur les zones réellement utilisées par les utilisateurs.

## Exemple d'audit d'un espace authentifié

```json
{
  "auth": {
    "username": "utilisateur",
    "password": "motdepasse"
  },
  "pages": [
    {
      "url": "https://application.exemple.fr"
    }
  ]
}
```

Une fois authentifié, BALDR peut parcourir l'application, analyser les différentes pages et produire des rapports détaillés au format HTML, JSON ou CSV.

## Les bénéfices pour les équipes

Grâce à cette approche, les équipes peuvent :

- auditer les applications réellement utilisées au quotidien ;
- détecter les défauts d'accessibilité dans les espaces authentifiés ;
- automatiser les contrôles RGAA et WCAG ;
- intégrer l'accessibilité dans les pipelines CI/CD ;
- réduire les risques de non-conformité ;
- améliorer l'expérience utilisateur sur l'ensemble du parcours numérique.

## Conclusion

Les applications authentifiées représentent aujourd'hui une part essentielle des systèmes d'information. Pourtant, elles sont encore rarement couvertes correctement par les solutions classiques de **web accessibility testing**.

En combinant **Puppeteer**, **axe-core**, l'automatisation des parcours utilisateurs et l'authentification automatique, BALDR permet de réaliser des **audits d'accessibilité RGAA et WCAG** sur les espaces réellement utilisés par les collaborateurs, les clients et les utilisateurs finaux.
