import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HeroSection from '@site/src/components/marketing/HeroSection';
import ProofStrip from '@site/src/components/marketing/ProofStrip';
import CapabilityGrid from '@site/src/components/marketing/CapabilityGrid';
import IntegrationFlows from '@site/src/components/marketing/IntegrationFlows';
import AudienceSection from '@site/src/components/marketing/AudienceSection';
import FinalCta from '@site/src/components/marketing/FinalCta';
import styles from './index.module.css';

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} | Audit accessibilite RGAA/WCAG`}
      description="Outil open source d'audit d'accessibilite RGAA et WCAG enrichi par IA, avec integration CLI, API et CI/CD.">
      <div className={styles.homeShell}>
        <HeroSection />
        <ProofStrip />
        <CapabilityGrid />
        <IntegrationFlows />
        <AudienceSection />
        <FinalCta />
      </div>
    </Layout>
  );
}
