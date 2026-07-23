import React, { useEffect } from 'react';

export default function Root({children}) {
  useEffect(() => {
    // Ensure proper landmark structure
    // Add role="banner" to navbar if not already marked as header
    const navbar = document.querySelector('nav[class*="navbar"]');
    if (navbar && !navbar.parentElement.tagName.toLowerCase() === 'header') {
      navbar.setAttribute('role', 'banner');
    }

    // Add role="contentinfo" to footer if not already marked as footer
    const footer = document.querySelector('footer');
    if (footer && !footer.getAttribute('role')) {
      footer.setAttribute('role', 'contentinfo');
    }
  }, []);

  return (
    <>
      {/* Skip link target for keyboard navigation - RGAA 4.1 Criterion 12.7 */}
      <div id="__docusaurus_skipToContent_fallback" tabIndex={-1} />
      <main role="main" className="docusaurus-main">
        {children}
      </main>
    </>
  );
}
