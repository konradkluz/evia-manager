/** The form of a Polish count word (`1 sesja`, `2 sesje`, `5 sesji`; styleguide § 6.3) by `Intl.PluralRules('pl')`; zero and the rest are the "many" form. */
export const pluralOf = (count: number): 'one' | 'few' | 'many' => {
  const category = new Intl.PluralRules('pl').select(count);
  return category === 'one' || category === 'few' ? category : 'many';
};
