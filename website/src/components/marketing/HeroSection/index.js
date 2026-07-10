import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const KpiItems = [
  {label: 'Criteres RGAA', value: '106'},
  {label: 'Tests statiques', value: '227'},
  {label: 'Tests intelligents (IA)', value: '498'},
  {label: 'Thematiques', value: '13'},
];

export default function HeroSection() {
  return (
    <section className={styles.hero}>
      <div className={clsx('container', styles.inner)}>
        <p className={styles.kicker}>BALDR Accessibility Scan</p>
        <Heading as="h1" className={styles.title}>
          Audit accessibilite RGAA et WCAG nouvelle generation
        </Heading>
        <p className={styles.subtitle}>
          Automatisez vos parcours, y compris les espaces authentifies, et obtenez
          des recommandations de remediations exploitables avec une analyse enrichie
          par IA.
        </p>

        <div className={styles.kpiWrap}>
          {KpiItems.map((item) => (
            <article key={item.label} className={styles.kpi}>
              <span className={styles.kpiValue}>{item.value}</span>
              <span className={styles.kpiLabel}>{item.label}</span>
            </article>
          ))}
        </div>

        <div className={styles.ctas}>
          <Link className={clsx('button button--lg', styles.primary)} to="/docs/">
            Demarrer en 30 secondes
          </Link>
          <Link className={clsx('button button--lg', styles.secondary)} to="/docs/journey-api">
            Explorer l'API Journey
          </Link>
        </div>
      </div>

      <div className={styles.gridOverlay} aria-hidden="true" />
      <div className={styles.glowOne} aria-hidden="true" />
      <div className={styles.glowTwo} aria-hidden="true" />
    </section>
  );
}
