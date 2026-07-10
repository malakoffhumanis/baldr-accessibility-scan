import Heading from '@theme/Heading';
import styles from './styles.module.css';

const Audience = [
  'Experts accessibilite',
  'Developpeurs front-end',
  'Equipes QA',
  'Product Owners',
  'Administrations publiques',
  'Grandes entreprises',
  'Equipes DevSecOps',
  'Auditeurs RGAA',
];

export default function AudienceSection() {
  return (
    <section className={styles.section}>
      <Heading as="h2">Concu pour les equipes produit, qualite et conformite</Heading>
      <div className={styles.tags}>
        {Audience.map((item) => (
          <span key={item} className={styles.tag}>
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
