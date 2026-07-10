import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

export default function FinalCta() {
  return (
    <section className={styles.section}>
      <Heading as="h2">
        Passez de l'audit ponctuel au pilotage continu de votre conformite accessibilite
      </Heading>
      <p>
        Demarrez avec la CLI, integrez BALDR dans votre pipeline CI/CD, puis
        exposez vos audits via l'API pour vos applications et portails metier.
      </p>
      <div className={styles.actions}>
        <Link className={clsx('button button--lg', styles.primary)} to="/docs/">
          Lire la documentation
        </Link>
        <Link className={clsx('button button--lg', styles.ghost)} to="/blog">
          Voir les cas d'usage
        </Link>
      </div>
    </section>
  );
}
