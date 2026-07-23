import React from 'react';

export default function Root({children}) {
  return (
    <>
      {/* Skip link target for keyboard navigation - RGAA 4.1 Criterion 12.7 */}
      <div id="__docusaurus_skipToContent_fallback" tabIndex={-1} />
      {children}
    </>
  );
}
