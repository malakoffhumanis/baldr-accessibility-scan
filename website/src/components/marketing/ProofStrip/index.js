import Heading from '@theme/Heading';
import styles from './styles.module.css';

const ProofItems = [
  {
    title: 'Parcours utilisateurs complets',
    description:
      <>BALDR audite des <span lang="en">journeys</span> <span lang="en">multi-pages</span>, y compris des interactions dynamiques.</>,
  },
  {
    title: 'Applications authentifiees',
    description:
      'Le moteur gere les etapes de connexion et permet des audits sur zones protegees.',
  },
  {
    title: 'Rapports exploitables',
    description:
      <>Production native de rapports <span lang="en">HTML</span>, <span lang="en">JSON</span> et <span lang="en">CSV</span> pour les equipes techniques et metier.</>,
  },
];

export default function ProofStrip() {
  return (
    <section className={styles.section}>
      <Heading as="h2" className={styles.title}>
        Pourquoi les equipes choisissent BALDR
      </Heading>
      <div className={styles.grid}>
        {ProofItems.map((item) => (
          <article key={item.title} className={styles.card}>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
