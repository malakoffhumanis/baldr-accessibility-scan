import React, {useEffect, useRef} from 'react';
import Root from '@theme-original/Root';

export default function RootWrapper(props) {
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    // Only run on client side, skip during SSR
    if (typeof document === 'undefined') {
      return;
    }

    const processElement = () => {
      const skipToContentDiv = document.getElementById('__docusaurus_skipToContent_fallback');
      if (skipToContentDiv && skipToContentDiv.tagName === 'DIV' && !hasProcessedRef.current) {
        try {
          // Create a new main element with the same attributes and content
          const mainElement = document.createElement('main');
          mainElement.id = skipToContentDiv.id;
          mainElement.className = skipToContentDiv.className;
          
          // Copy all child nodes
          while (skipToContentDiv.firstChild) {
            mainElement.appendChild(skipToContentDiv.firstChild);
          }
          
          // Copy all other attributes
          for (let attr of skipToContentDiv.attributes) {
            if (attr.name !== 'id' && attr.name !== 'class') {
              mainElement.setAttribute(attr.name, attr.value);
            }
          }
          
          // Replace the div with the main element
          if (skipToContentDiv.parentNode) {
            skipToContentDiv.parentNode.replaceChild(mainElement, skipToContentDiv);
          }
          
          hasProcessedRef.current = true;
          return true;
        } catch (e) {
          console.warn('Failed to transform skipToContent div to main element:', e);
          return false;
        }
      }
      return false;
    };

    // Try to process immediately
    if (!processElement()) {
      // If element not found, retry after a short delay
      const timeoutId = setTimeout(() => {
        processElement();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, []);

  return <Root {...props} />;
}
