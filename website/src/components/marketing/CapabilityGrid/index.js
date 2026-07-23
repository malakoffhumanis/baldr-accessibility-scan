import Heading from '@theme/Heading';
import styles from './styles.module.css';

const Features = [
  'Controles RGAA et WCAG',
  <>Analyse <span lang="en">axe-core</span> + enrichissement <span lang="en">IA</span></>,
  'Recommandations de remediation actionnables',
  'Scoring de conformite et priorisation',
  'Gestion des cookies et parcours complexes',
  <>Mode <span lang="en">CLI</span>, <span lang="en">API HTTP</span> et <span lang="en">Docker</span></>,
];

export default function CapabilityGrid() {
  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <Heading as="h2">Fonctionnalites cles pour industrialiser vos audits</Heading>
      </div>
      <div className={styles.grid}>
        {Features.map((label) => (
          <article key={label} className={styles.item}>
            <span className={styles.dot} aria-hidden="true" />
            <p>{label}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
