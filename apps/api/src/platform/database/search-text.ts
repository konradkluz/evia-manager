/**
 * The one place that matches a search phrase against a `search_text` column (SR-INPUT-03; ASVS V1.2.4; CWE-89, CWE-180). The phrase
 * is normalised HERE by the same function as the column (`f_unaccent(lower(…))`), so "Lodz" meets "Łódź", and ESCAPED AFTER that
 * (`\`, `%`, `_`): unaccent maps full-width look-alikes to the ASCII pattern characters, so escaping before it would leave a
 * pattern. The phrase is a bound parameter — never part of the statement. The trigram index serves `ILIKE '%…%'`.
 */
import { sql, type RawBuilder } from 'kysely';

export const searchTextMatches = (term: string): RawBuilder<boolean> =>
  sql<boolean>`search_text ilike '%' || replace(replace(replace(public.f_unaccent(lower(${term})), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' escape '\\'`;
