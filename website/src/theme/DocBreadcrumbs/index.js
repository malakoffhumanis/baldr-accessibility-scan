import React from 'react';
import {useSidebarBreadcrumbs} from '@docusaurus/theme-common/internal';
import Link from '@docusaurus/Link';
import HomeIcon from '@theme/Icon/Home';
import styles from './styles.module.css';

function BreadcrumbsItemLink({children, href, isLast}) {
  const className = 'breadcrumbs__link';
  if (isLast) {
    return <span className={className} aria-current="page">{children}</span>;
  }
  return (
    <Link className={className} href={href} itemProp="url">
      <span itemProp="title">{children}</span>
    </Link>
  );
}

function BreadcrumbsItem({children, active, index, items}) {
  const isLast = index === items.length - 1;
  return (
    <li
      {...{itemScope: true, itemType: 'https://schema.org/BreadcrumbList'}}
      itemProp="itemListElement"
      className="breadcrumbs__item">
      <BreadcrumbsItemLink isLast={isLast} href={active} title={typeof children === 'string' && children}>
        {children}
      </BreadcrumbsItemLink>
      <meta itemProp="position" content={String(index + 1)} />
    </li>
  );
}

export default function DocBreadcrumbs() {
  const breadcrumbs = useSidebarBreadcrumbs();
  const homePageRoute = '/';

  if (!breadcrumbs) {
    return null;
  }

  return (
    <nav
      className="navbar__inner"
      aria-label="Fil d'Ariane"
      {...{itemScope: true, itemType: 'https://schema.org/BreadcrumbList'}}>
      <ol className="breadcrumbs">
        <li className="breadcrumbs__item">
          <Link
            className="breadcrumbs__link"
            href={homePageRoute}
            title="Page d'accueil">
            <HomeIcon svgClass={styles.breadcrumbsItemLinkIcon} />
          </Link>
        </li>
        {breadcrumbs.map((item, idx) => (
          <BreadcrumbsItem
            key={idx}
            active={item.href}
            index={idx + 1}
            items={[...breadcrumbs]}>
            {item.label}
          </BreadcrumbsItem>
        ))}
      </ol>
    </nav>
  );
}
