import Heading from '@theme/Heading';
import styles from './styles.module.css';

const Pipelines = [
  {
    title: 'Integration CI/CD',
    steps: [
      {text: 'Build', lang: 'en'},
      {text: 'Deploy', lang: 'en'},
      {text: 'Baldr Audit RGAA', lang: null},
      {text: 'Gate', lang: 'en'},
      {text: 'Release', lang: 'en'},
    ],
  },
  {
    title: 'Integration CLI',
    steps: [
      {text: 'Developpement', lang: null},
      {text: 'Local', lang: null},
      {text: 'Serveur', lang: null},
    ],
  },
  {
    title: 'Integration API',
    steps: [
      {text: 'Audit applicatif', lang: null},
      {text: 'Client API', lang: null},
      {text: 'curl', lang: null},
    ],
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
                <div key={step.text} className={styles.stepWrap}>
                  <span className={styles.step} lang={step.lang || undefined}>{step.text}</span>
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
