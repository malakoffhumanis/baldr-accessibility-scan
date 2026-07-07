/****************** DÉBUT DE LA CONFIGURATION UTILISATEUR *****************/

/**
 * Personnalisation de la configuration de la chaîne d'intégration continue
 */
userConfig = [
    //***** Commun
    // logLevel: 'DEBUG',                                                 // optionnel - Niveau de journalisation souhaité (DEBUG, INFO, WARNING, ERROR)
    // gabaritConteneur: 'DOCKER_TEMPLATE_4GO',                           // optionnel - Caractéristiques du conteneur à utiliser pour les builds

    //***** Spécifique au framework Node
    imageBuild: 'tools-store/usil-nodejs-22:1.0.0',           // requis - Image de build Node.js
]

/**
 * Définition des environnements de déploiement cibles pour le déploiement continu
 * en fonction des branches.
 */
deploymentTargetsByBranch = [
    'main':     [ 'e3', 'e2' ],
]

/**
 * Définition des variantes pour chaque environnement (optionnel)
 * Décommenter si vous avez plusieurs configurations de déploiement
 * Les configurations correspondantes doivent exister dans Vault
 * Exemples :
 *   - USI/usi_3u_axecore_kube/e4
 *   - USI/usi_3u_axecore_kube-variant1/e4
 */
// environmentVariants = [
//    '',           // Variante par défaut (sans suffixe)
//    '-variant1',  // Variante 1
// ]

/****************** FIN DE LA CONFIGURATION UTILISATEUR *******************/

/**
 * Pipeline d'intégration et de déploiement continu
 */

// Chargement des librairies partagées
@Library('Usil') _

import fr.usil.Pipeline

Pipeline pipeline = new Pipeline(this, userConfig)

// Éxecution de la chaîne d'intégration continue
pipeline.ci()

// Éxecution de la chaîne de déploiement continu
List<String> targetEnvironments = deploymentTargetsByBranch.find { pattern, target ->  
    pipeline.config.git.branchName.matches(~/$pattern/) 
}?.value

List<String> targetVariants = binding.hasVariable('environmentVariants') ? environmentVariants : ['']

if (targetEnvironments) {
    echo("Environnements de deploiement cibles : ${targetEnvironments.join(', ')}")

    // Construction de l'image Docker
    Map imageInfo = pipeline.bi()
    echo("Image ${imageInfo.name} construite avec le tag ${imageInfo.tag}")

    // Pour chaque environnement cible
    for (environment in targetEnvironments) {
        for (variant in targetVariants) {
            // Deploiement sur TKGS
            echo("Deploiement vers l'environnement cible : ${environment}${variant}.")
            pipeline.cd(imageInfo, environment, variant)

            // Execution des tests post deploiement
            echo("Execution des tests post deploiement pour ${environment}${variant}.")
            pipeline.tpd(environment, variant)
        }
    }
} else {
    echo("Aucun environnement de deploiement configure pour la branche ${pipeline.config.git.branchName}")
}

// Nettoyage des espaces de travail
pipeline.cleanWs()