import Heading from '@theme/Heading';
import styles from './styles.module.css';

const Audience = [
  'Experts accessibilite',
  'Developpeurs front-end',
  (
    <>
      Equipes <span lang="en">QA</span>
    </>
  ),
  (
    <>
      <span lang="en">Product Owners</span>
    </>
  ),
  'Administrations publiques',
  'Grandes entreprises',
  (
    <>
      Equipes <span lang="en">DevSecOps</span>
    </>
  ),
  'Auditeurs RGAA',
];

export default function AudienceSection() {
  return (
    <section className={styles.section}>
      <Heading as="h2">Concu pour les equipes produit, qualite et conformite</Heading>
      <div className={styles.tags}>
        {Audience.map((item) => (
          <span key={typeof item === 'string' ? item : item.key || item.toString()} className={styles.tag}>
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
