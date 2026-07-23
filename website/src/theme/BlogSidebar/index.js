import React from 'react';
import clsx from 'clsx';
import {translate} from '@docusaurus/Translate';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

export default function BlogSidebar({sidebar}) {
  if (sidebar.length === 0) {
    return null;
  }
  return (
    <aside className="col col--3">
      <nav
        className={clsx(styles.sidebar, 'thin-scrollbar')}
        aria-label={translate({
          id: 'theme.blog.sidebar.navAriaLabel',
          message: 'Blog sidebar navigation',
          description: 'The ARIA label for the sidebar navigation',
        })}>
        <div className={clsx(styles.sidebarItemTitle, 'margin-bottom--md')}>
          <span lang="en">Recent posts</span>
        </div>
        <ul className={clsx(styles.sidebarItemList, 'clean-list')}>
          {sidebar.map((item) => (
            <li key={item.permalink} className={styles.sidebarItem}>
              <Link
                isNavLink
                to={item.permalink}
                className={styles.sidebarItemLink}
                activeClassName={styles.sidebarItemLinkActive}>
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
