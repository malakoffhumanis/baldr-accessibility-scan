import React from 'react';
import Layout from '@theme-original/Layout';

export default function LayoutWrapper(props) {
  return (
    <Layout {...props}>
      <main role="main" className="main-content">
        {props.children}
      </main>
    </Layout>
  );
}
