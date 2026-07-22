import React from 'react';

// Treat external-link icon as decorative because link text already conveys meaning.
export default function IconExternalLink({width = 13.5, height = 13.5}) {
  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
      className="iconExternalLink_nPIU">
      <use href="#theme-svg-external-link" />
    </svg>
  );
}
