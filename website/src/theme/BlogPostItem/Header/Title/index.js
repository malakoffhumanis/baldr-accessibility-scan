/**
 * Swizzle override of BlogPostItemHeaderTitle.
 * Forces h1 for all blog post titles (listing page + post page).
 */
import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {useBlogPost} from '@docusaurus/plugin-content-blog/client';
import styles from './styles.module.css';

export default function BlogPostItemHeaderTitle({className}) {
  const {metadata, isBlogPostPage} = useBlogPost();
  const {permalink, title} = metadata;
  return (
    <h1 className={clsx(styles.title, className)}>
      {isBlogPostPage ? title : <Link to={permalink}>{title}</Link>}
    </h1>
  );
}
