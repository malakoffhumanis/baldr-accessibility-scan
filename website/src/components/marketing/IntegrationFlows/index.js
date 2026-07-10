import Heading from '@theme/Heading';
import styles from './styles.module.css';

const Pipelines = [
  {
    title: 'Integration CI/CD',
    steps: ['Build', 'Deploy', 'Baldr Audit RGAA', 'Gate', 'Release'],
  },
  {
    title: 'Integration CLI',
    steps: ['Developpement', 'Local', 'Serveur'],
  },
  {
    title: 'Integration API',
    steps: ['Audit applicatif', 'Client API', 'curl'],
  },
];

export default function IntegrationFlows() {
  return (
    <section className={styles.section}>
      <Heading as="h2" className={styles.title}>
        BALDR s'integre a votre chaine d'outils
      </Heading>
      <div className={styles.stack}>
        {Pipelines.map((flow) => (
          <article key={flow.title} className={styles.flow}>
            <h3>{flow.title}</h3>
            <div className={styles.steps}>
              {flow.steps.map((step, index) => (
                <div key={step} className={styles.stepWrap}>
                  <span className={styles.step}>{step}</span>
                  {index < flow.steps.length - 1 && (
                    <span className={styles.arrow} aria-hidden="true">
                      ▸
                    </span>
                  )}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
