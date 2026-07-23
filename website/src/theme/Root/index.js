import React, {useEffect, useRef} from 'react';
import Root from '@theme-original/Root';

export default function RootWrapper(props) {
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const processElement = () => {
      const skipToContentDiv = document.getElementById('__docusaurus_skipToContent_fallback');
      if (skipToContentDiv && skipToContentDiv.tagName === 'DIV') {
        // Create a new main element with the same attributes and content
        const mainElement = document.createElement('main');
        mainElement.id = skipToContentDiv.id;
        mainElement.className = skipToContentDiv.className;
        
        // Copy all child nodes (not just innerHTML to preserve event listeners)
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
        skipToContentDiv.parentNode.replaceChild(mainElement, skipToContentDiv);
        hasProcessedRef.current = true;
        return true;
      }
      return false;
    };

    // Try to process immediately
    if (!hasProcessedRef.current) {
      if (!processElement()) {
        // If element not found, wait a bit and try again
        const timeout = setTimeout(processElement, 100);
        return () => clearTimeout(timeout);
      }
    }

    // Use MutationObserver as a fallback to catch dynamic elements
    if (!hasProcessedRef.current) {
      const observer = new MutationObserver((mutations) => {
        if (!hasProcessedRef.current && processElement()) {
          observer.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      return () => observer.disconnect();
    }
  }, []);

  return <Root {...props} />;
}
