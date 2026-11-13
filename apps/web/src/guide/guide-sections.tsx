import { Card, DataTable, TextLink, type LinkComponent } from '@evia/ui-web';
import { useRouterState } from '@tanstack/react-router';
import { Fragment, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import source from '../../../../docs/user/instrukcja-dla-biura.md?raw';
import { parseGuide, type GuideBlock, type InlinePart, type ListBlock } from './markdown.ts';

const GUIDE = parseGuide(source);
const HEADINGS = GUIDE.blocks.flatMap((block) => (block.kind === 'heading' ? [block] : []));
const HEADING_IDS = new Set(HEADINGS.map((heading) => heading.id));
const SECTION_HEADING = 'scroll-mt-app-bar-height-web focus-visible:focus-ring';

/**
 * A link of the table of contents moves focus to the section (WCAG 2.4.3) without a change of the address; the
 * identifier is a positional one of this page (the links are built from the headings of the source).
 */
const SectionLink: LinkComponent = ({ href, children, ...rest }) => (
  <a
    href={href}
    {...rest}
    onClick={(event) => {
      event.preventDefault();
      document.getElementById(href.slice(1))?.focus();
    }}
  >
    {children}
  </a>
);

function Inline({ parts }: { readonly parts: readonly InlinePart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part.bold ? <strong>{part.text}</strong> : part.text}</Fragment>
      ))}
    </>
  );
}

function List({ list }: { readonly list: ListBlock }) {
  const Tag = list.ordered ? 'ol' : 'ul';
  return (
    <Tag className={`flex flex-col gap-stack-xs ps-inset-lg text-body text-text-primary ${list.ordered ? 'list-decimal' : 'list-disc'}`}>
      {list.items.map((item, index) => (
        <li key={index}>
          <Inline parts={item.parts} />
          {item.children === null ? null : <List list={item.children} />}
        </li>
      ))}
    </Tag>
  );
}

function Block({ block, tableCaption }: { readonly block: GuideBlock; readonly tableCaption: string }): ReactNode {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 id={block.id} tabIndex={-1} className={`font-display text-heading-2 text-text-primary ${SECTION_HEADING}`}>
          {block.text}
        </h2>
      ) : (
        <h3 id={block.id} tabIndex={-1} className={`text-heading-3 text-text-primary ${SECTION_HEADING}`}>
          {block.text}
        </h3>
      );
    case 'paragraph':
      return (
        <p className="text-body text-text-primary">
          <Inline parts={block.parts} />
        </p>
      );
    case 'list':
      return <List list={block} />;
    case 'table':
      return (
        <DataTable
          caption={tableCaption}
          columns={block.header.map((header, index) => ({ id: String(index), header }))}
          rows={block.rows.map((row, index) => ({ id: String(index), cells: row }))}
        />
      );
  }
}

/**
 * The body of "Instrukcja dla biura" (EVM-066 AC6; a chunk of its own, like the body of W-19): a table of contents and
 * the sections, all made from the Markdown source at build time. A heading is reached by its positional identifier from
 * a whitelist built from the source — the fragment of the address never becomes a selector (CWE-20).
 */
export default function GuideSections() {
  const { t } = useTranslation();
  const hash = useRouterState({ select: (state) => state.location.hash });
  useEffect(() => {
    if (HEADING_IDS.has(hash)) document.getElementById(hash)?.focus();
  }, [hash]);
  return (
    <div className="flex flex-col gap-stack-lg">
      <Card labelledBy="guide-toc">
        <h2 id="guide-toc" className="font-display text-heading-2 text-text-primary">
          {t('guide.toc')}
        </h2>
        <nav aria-labelledby="guide-toc">
          <ul className="flex flex-col gap-stack-xs text-body">
            {HEADINGS.map((heading) => (
              <li key={heading.id} className={heading.level === 3 ? 'ps-inset-lg' : undefined}>
                <TextLink href={`#${heading.id}`} link={SectionLink}>
                  {heading.text}
                </TextLink>
              </li>
            ))}
          </ul>
        </nav>
      </Card>
      <article className="flex flex-col gap-stack-md">
        {GUIDE.blocks.map((block, index) => (
          <Block key={index} block={block} tableCaption={t('guide.tableCaption')} />
        ))}
      </article>
    </div>
  );
}
