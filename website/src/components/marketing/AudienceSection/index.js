import Heading from '@theme/Heading';
import styles from './styles.module.css';

const Audience = [
  {text: 'Experts accessibilite', lang: null},
  {text: 'Developpeurs front-end', lang: null},
  {text: 'Equipes QA', lang: null},
  {text: 'Product Owners', lang: 'en'},
  {text: 'Administrations publiques', lang: null},
  {text: 'Grandes entreprises', lang: null},
  {text: 'Equipes DevSecOps', lang: 'en'},
  {text: 'Auditeurs RGAA', lang: null},
];

export default function AudienceSection() {
  return (
    <section className={styles.section}>
      <Heading as="h2">Concu pour les equipes produit, qualite et conformite</Heading>
      <div className={styles.tags}>
        {Audience.map((item) => (
          <span key={item.text} className={styles.tag} lang={item.lang || undefined}>
            {item.text}
          </span>
        ))}
      </div>
    </section>
  );
}
