import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { MINUTE } from '../support/clock.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await clearCustomers(current.database.admin);
});

const LIST = '/api/v1/customers';
const SEARCH = '/api/v1/customers/search';
const admin = () => current.database.admin;

/** A signed-in browser of a NEW user of the role (every user has their own search limit and mass-read window). */
async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user);
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

interface Item {
  id: string;
  kind: string;
  displayName: string;
  sortName: string;
  phone: string;
  email: string | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const sortNames = (page: Page): string[] => page.items.map((item) => item.sortName);

const list = async (browser: Browser, query = ''): Promise<Page> => {
  const response = await browser.panel.get(`${LIST}${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
const searchPage = async (browser: Browser, body: Record<string, unknown>): Promise<Page> => {
  const response = await browser.panel.post(SEARCH, body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as Page;
};
/** Every page of a walk through the list, following `nextCursor` until it is null. */
async function walk(fetchPage: (cursor: string | undefined) => Promise<Page>): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && pages.length < 50);
  return pages;
}

const PEOPLE = [
  { firstName: 'Łukasz', lastName: 'Testowy' },
  { firstName: 'Lucyna', lastName: 'Przykładowa' },
  { firstName: 'Marek', lastName: 'Fikcyjny' },
];

describe('the list of customers (EVM-039 AC1; SR-API-04, SR-AUTHZ-03)', () => {
  it('EVM-039 AC1 the customers Łukasz Testowy, Lucyna Przykładowa and Marek Fikcyjny are sorted by surname before first name', async () => {
    for (const person of PEOPLE) await insertCustomer(admin(), person);
    const page = await list(await signIn('read_only'));
    expect(sortNames(page)).toEqual(['Fikcyjny Marek', 'Przykładowa Lucyna', 'Testowy Łukasz']);
    expect(page.nextCursor).toBeNull();
  });

  it('EVM-039 AC1 "Ł" sorts after "L" (ICU pl-PL), not after "Z": Licznikowy, Ładowarkowa, Przykładowa — and a company by its name', async () => {
    for (const lastName of ['Przykładowa', 'Ładowarkowa', 'Licznikowy', 'Zawada'])
      await insertCustomer(admin(), { lastName, firstName: 'Ewa' });
    await insertCustomer(admin(), { kind: 'company', companyName: 'Magazyn Testowy sp. z o.o.' });
    const page = await list(await signIn());
    expect(sortNames(page)).toEqual(['Licznikowy Ewa', 'Ładowarkowa Ewa', 'Magazyn Testowy sp. z o.o.', 'Przykładowa Ewa', 'Zawada Ewa']);
  });

  it('EVM-039 AC1 an item carries the columns of the list and nothing else: kind, display and sort name, telephone, e-mail (or null)', async () => {
    const id = await insertCustomer(admin(), { email: 'jan@example.test', notes: 'notatka-poufna', city: 'Łódź' });
    const page = await list(await signIn('read_only'));
    expect(page.items).toEqual([
      {
        id,
        kind: 'person',
        displayName: 'Jan Przykładowy',
        sortName: 'Przykładowy Jan',
        phone: '+48600000001',
        email: 'jan@example.test',
      },
    ]);
    expect(JSON.stringify(page)).not.toMatch(/notatka-poufna|Piotrkowska|searchText|search_text|deletedAt/);
  });

  it('EVM-039 AC1 the page is cut by a keyset cursor: every customer once, in order, the last page has a null cursor, a page has at most `limit` items', async () => {
    for (let index = 0; index < 7; index += 1)
      await insertCustomer(admin(), { lastName: `Seria${String(index).padStart(2, '0')}`, firstName: 'Ola' });
    const browser = await signIn();
    const pages = await walk(async (cursor) => list(browser, `?limit=3${cursor === undefined ? '' : `&cursor=${cursor}`}`));
    expect(pages.map((page) => page.items.length)).toEqual([3, 3, 1]);
    expect(pages.flatMap(sortNames)).toEqual(Array.from({ length: 7 }, (_, index) => `Seria0${index} Ola`));
    expect(pages.at(-1)?.nextCursor).toBeNull();
    expect(pages[0]?.nextCursor).toMatch(/^[A-Za-z0-9_-]{20,512}$/);
  });

  it('EVM-039 AC1 a page of exactly `limit` customers has no next page (one more row is read to know)', async () => {
    for (let index = 0; index < 3; index += 1) await insertCustomer(admin(), { lastName: `Trzy${String(index)}` });
    const page = await list(await signIn(), '?limit=3');
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('EVM-039 AC1 the default page is 25 customers, the largest 100', async () => {
    await sql`
      insert into customers.customers (id, kind, first_name, last_name, phone, created_at, updated_at)
      select ('0198b0a0-0000-7000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, 'person', 'Seria', 'Nazwisko' || lpad(n::text, 3, '0'), '+48600000001', now(), now()
      from generate_series(1, 120) as n`.execute(admin());
    const browser = await signIn();
    expect((await list(browser)).items).toHaveLength(25);
    expect((await list(browser, '?limit=100')).items).toHaveLength(100);
  });

  it('EVM-039 AC1 A1 two names of 200 + 200 characters with Polish letters page without a duplicate and the cursor holds no name', async () => {
    const long = (letter: string) => 'Łąęóśćźż'.padEnd(200, letter);
    for (const letter of ['a', 'b', 'c']) {
      await insertCustomer(admin(), { firstName: long('ź'), lastName: long(letter) });
    }
    const browser = await signIn();
    const first = await list(browser, '?limit=2');
    expect(first.items).toHaveLength(2);
    const cursor = first.nextCursor ?? '';
    expect(cursor.length).toBeGreaterThan(0);
    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(Buffer.from(cursor, 'base64url').toString('utf8')).not.toContain('ŁŁ'); // opaque: no readable name
    const second = await list(browser, `?limit=2&cursor=${cursor}`);
    expect(second.items).toHaveLength(1);
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
    expect(second.nextCursor).toBeNull();
  });

  it('EVM-039 AC1 a customer with the same sort name as another is told apart by the id: no duplicate and no gap between pages', async () => {
    for (let index = 0; index < 5; index += 1) await insertCustomer(admin(), { firstName: 'Jan', lastName: 'Powtorzony' });
    const browser = await signIn();
    const pages = await walk(async (cursor) => list(browser, `?limit=2${cursor === undefined ? '' : `&cursor=${cursor}`}`));
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort()).toEqual(ids);
  });

  it('EVM-039 AC6 a customer who was soft deleted while the user paged does not break the paging (the position is not read through the policy)', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1)
      ids.push(await insertCustomer(admin(), { lastName: `Strona${String(index)}`, firstName: 'Ola' }));
    const browser = await signIn();
    const first = await list(browser, '?limit=2');
    const lastShown = first.items.at(-1)?.id ?? '';
    await sql`update customers.customers set deleted_at = now() where id = ${lastShown}`.execute(admin());
    const second = await list(browser, `?limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2));
  });

  it('EVM-039 AC1 a customer who is gone for good (a hard delete, EVM-041) leaves no position: 400 invalid_cursor', async () => {
    for (let index = 0; index < 3; index += 1) await insertCustomer(admin(), { lastName: `Znika${String(index)}` });
    const browser = await signIn();
    const first = await list(browser, '?limit=2');
    await sql`delete from customers.customers where id = ${first.items.at(-1)?.id ?? ''}`.execute(admin());
    const response = await browser.panel.get(`${LIST}?limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('invalid_cursor');
  });

  it('EVM-039 AC6 soft deleted customers are on no page of the list: the condition is in the query', async () => {
    await insertCustomer(admin(), { lastName: 'Widoczny' });
    await insertCustomer(admin(), { lastName: 'Usuniety', deletedAt: '2026-10-02T08:00:00Z' });
    const browser = await signIn('administrator');
    const pages = await walk(async (cursor) => list(browser, `?limit=1${cursor === undefined ? '' : `&cursor=${cursor}`}`));
    expect(pages.flatMap(sortNames)).toEqual(['Widoczny Jan']);
  });

  it('EVM-039 AC1 an empty table is an empty list with a null cursor', async () => {
    expect(await list(await signIn())).toEqual({ items: [], nextCursor: null });
  });
});

describe('the cursor of the list (EVM-039 AC1; SR-API-04, SR-API-01, ASVS V14.2.1)', () => {
  const seed = async () => {
    for (let index = 0; index < 4; index += 1) await insertCustomer(admin(), { lastName: `Kursor${String(index)}`, firstName: 'Ola' });
  };

  it('EVM-039 AC1 a garbled, a foreign, a too long and a malformed cursor is the same 400 invalid_cursor / validation_failed, with no detail', async () => {
    await seed();
    const browser = await signIn();
    const valid = (await list(browser, '?limit=2')).nextCursor ?? '';
    const flipped = `${valid.slice(0, -2)}${valid.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const cursor of [flipped, 'garbage', 'A'.repeat(100)]) {
      const response = await browser.panel.get(`${LIST}?cursor=${cursor}`);
      expect(response.status, cursor).toBe(400);
      expect(codeOf(response.body)).toBe('invalid_cursor');
    }
    expect((await browser.panel.get(`${LIST}?cursor=${'A'.repeat(513)}`)).status).toBe(400);
    expect((await browser.panel.get(`${LIST}?cursor=not%20base64`)).status).toBe(400);
  });

  it('EVM-039 AC1 a cursor issued to another user is refused (it is bound to the user)', async () => {
    await seed();
    const owner = await signIn();
    const stranger = await signIn();
    const cursor = (await list(owner, '?limit=2')).nextCursor ?? '';
    const response = await stranger.panel.get(`${LIST}?limit=2&cursor=${cursor}`);
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('invalid_cursor');
  });

  it('EVM-039 AC1 a cursor expires after 30 minutes', async () => {
    await seed();
    const browser = await signIn();
    const cursor = (await list(browser, '?limit=2')).nextCursor ?? '';
    expect((await browser.panel.get(`${LIST}?limit=2&cursor=${cursor}`)).status).toBe(200);
    current.clock.advance(31 * MINUTE);
    const response = await browser.panel.get(`${LIST}?limit=2&cursor=${cursor}`);
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('invalid_cursor');
  });

  it('EVM-039 AC1 the cursor of the list does not open in the search, nor the one of the search in the list', async () => {
    await seed();
    const browser = await signIn();
    const listCursor = (await list(browser, '?limit=2')).nextCursor ?? '';
    const searchCursor = (await searchPage(browser, { query: 'kursor', limit: 2 })).nextCursor ?? '';
    expect(searchCursor.length).toBeGreaterThan(0);
    const inSearch = await browser.panel.post(SEARCH, { query: 'kursor', limit: 2, cursor: listCursor });
    expect(inSearch.status).toBe(400);
    expect(codeOf(inSearch.body)).toBe('invalid_cursor');
    const inList = await browser.panel.get(`${LIST}?limit=2&cursor=${searchCursor}`);
    expect(inList.status).toBe(400);
    expect(codeOf(inList.body)).toBe('invalid_cursor');
  });

  it('EVM-039 AC1 the cursor of a search is bound to its phrase: the same cursor with another phrase is refused', async () => {
    await seed();
    await insertCustomer(admin(), { lastName: 'Inny', firstName: 'Kursor Ola' });
    const browser = await signIn();
    const cursor = (await searchPage(browser, { query: 'kursor', limit: 2 })).nextCursor ?? '';
    const other = await browser.panel.post(SEARCH, { query: 'inny', limit: 2, cursor });
    expect(other.status).toBe(400);
    expect(codeOf(other.body)).toBe('invalid_cursor');
  });

  it('EVM-039 AC1 limit 0, 101, a word, a decimal, a repeated or an unknown parameter is a 400 — never a 500', async () => {
    const browser = await signIn();
    for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?limit=2.5', '?limit=-1', '?limit=1000']) {
      const response = await browser.panel.get(`${LIST}${query}`);
      expect(response.status, query).toBe(400);
      expect(codeOf(response.body), query).toBe('validation_failed');
    }
    const duplicate = await browser.panel.get(`${LIST}?limit=2&limit=3`);
    expect(duplicate.status).toBe(400);
    expect(codeOf(duplicate.body)).toBe('duplicate_parameter');
    const unknown = await browser.panel.get(`${LIST}?q=lodz`);
    expect(unknown.status).toBe(400);
    expect(codeOf(unknown.body)).toBe('unknown_parameter');
    const sorted = await browser.panel.get(`${LIST}?sort=-name`);
    expect(codeOf(sorted.body)).toBe('unknown_parameter');
  });
});

describe('the search with pages (EVM-039 AC1; SR-API-04, SR-INPUT-03)', () => {
  it('EVM-039 AC1 the search narrows the list in the same order, "Lodz" finds a customer from Łódź, and pages with a cursor in the body', async () => {
    for (let index = 0; index < 5; index += 1) {
      await insertCustomer(admin(), { lastName: `Lodzianin${String(index)}`, firstName: 'Ola', city: 'Łódź' });
    }
    await insertCustomer(admin(), { lastName: 'Gdanski', city: 'Gdańsk' });
    const browser = await signIn();
    const pages = await walk(async (cursor) =>
      searchPage(browser, { query: 'Lodz', limit: 2, ...(cursor === undefined ? {} : { cursor }) }),
    );
    expect(pages.map((page) => page.items.length)).toEqual([2, 2, 1]);
    expect(pages.flatMap(sortNames)).toEqual(Array.from({ length: 5 }, (_, index) => `Lodzianin${index} Ola`));
  });

  it('EVM-039 AC1 a phrase of fewer than 3 characters is 400 too_short; an out-of-range limit in the body is out_of_range', async () => {
    const browser = await signIn();
    const short = await browser.panel.post(SEARCH, { query: 'ab' });
    expect(short.status).toBe(400);
    expect(errorsOf(short.body)).toEqual([{ pointer: '/query', code: 'too_short' }]);
    const range = await browser.panel.post(SEARCH, { query: 'abc', limit: 0 });
    expect(errorsOf(range.body)).toEqual([{ pointer: '/limit', code: 'out_of_range' }]);
  });

  it('EVM-039 AC1 the list and the search agree: what the list shows the search finds, and soft deleted customers are in neither', async () => {
    await insertCustomer(admin(), { lastName: 'Zgodny' });
    await insertCustomer(admin(), { lastName: 'Zgodny', firstName: 'Usuniety', deletedAt: '2026-10-02T08:00:00Z' });
    const browser = await signIn('administrator');
    const found = await searchPage(browser, { query: 'zgodny' });
    expect(found.items.map((item) => item.displayName)).toEqual(['Jan Zgodny']);
    expect((await list(browser)).items.map((item) => item.displayName)).toEqual(['Jan Zgodny']);
  });
});
