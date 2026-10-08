import { TextLink } from '@evia/ui-web';
import { Fragment } from 'react';
import { safeHref } from './safe-href.ts';

/** Trailing punctuation that belongs to the sentence, not to the address ("zobacz https://example.pl/a."). */
const PUNCTUATION = '.,;:!?)]';
const SCHEME = /^(?:https:\/\/|mailto:|tel:)/iu;

/** The length of the word without the punctuation at its end — one pass from the end, no backtracking (CWE-1333). */
function wordLength(part: string): number {
  let end = part.length;
  while (end > 0 && PUNCTUATION.includes(part.charAt(end - 1))) end -= 1;
  return end;
}

/**
 * Plain text in which the addresses that may be links are links (EVM-018 AC4; SR-WEB-03): the text is split on whitespace
 * (linear, no nested quantifiers — CWE-1333), and only a word that begins with `https://`, `mailto:` or `tel:` AND passes
 * `safeHref` becomes a link. Everything else — `<script>`, `javascript:alert(1)` — is rendered as React text, which escapes it.
 * Line breaks of the note are kept (`whitespace-pre-line` on the paragraph).
 */
export function LinkedText({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/(\s+)/u).map((part, index) => {
        const length = wordLength(part);
        const word = part.slice(0, length);
        const trailing = part.slice(length);
        const href = SCHEME.test(word) ? safeHref(word) : undefined;
        return (
          <Fragment key={index}>
            {href === undefined ? (
              part
            ) : (
              <>
                <TextLink href={href}>{word}</TextLink>
                {trailing}
              </>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
