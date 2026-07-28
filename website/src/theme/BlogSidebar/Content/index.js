/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, {memo} from 'react';
import {useThemeConfig} from '@docusaurus/theme-common';
import {groupBlogSidebarItemsByYear} from '@docusaurus/plugin-content-blog/client';
function BlogSidebarYearGroup({year, yearGroupHeadingClassName, children}) {
  return (
    <div role="group">
      <p className={yearGroupHeadingClassName}>
        {year}
      </p>
      {children}
    </div>
  );
}

function BlogSidebarContent({items, yearGroupHeadingClassName, ListComponent}) {
  const themeConfig = useThemeConfig();

  if (themeConfig.blog.sidebar.groupByYear) {
    const itemsByYear = groupBlogSidebarItemsByYear(items);
    return (
      <>
        {itemsByYear.map(([year, yearItems]) => (
          <BlogSidebarYearGroup
            key={year}
            year={year}
            yearGroupHeadingClassName={yearGroupHeadingClassName}>
            <ListComponent items={yearItems} />
          </BlogSidebarYearGroup>
        ))}
      </>
    );
  }

  return <ListComponent items={items} />;
}

export default memo(BlogSidebarContent);
