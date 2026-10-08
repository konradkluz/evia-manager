import type { SiteSearchItem } from '@evia/contracts';
import type { TFunction } from 'i18next';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';

type AddressFields = Pick<SiteSearchItem, 'street' | 'buildingNumber' | 'apartmentNumber' | 'postalCode' | 'city'>;
type SpotFields = Pick<SiteSearchItem, 'parkingSpotNumber' | 'garageLevel'>;

/** "ul. Testowa 7/3, 00-001 Warszawa" — the address as it is read (the apartment after a slash). */
export function formatAddress(site: AddressFields): string {
  const number = site.apartmentNumber === undefined ? site.buildingNumber : `${site.buildingNumber}/${site.apartmentNumber}`;
  return `${site.street} ${number}, ${site.postalCode} ${site.city}`;
}

/** "miejsce 15, poziom -1" — the parking spot and the level of a garage; `undefined` when the site has neither. */
export function formatSpot(t: TFunction, site: SpotFields): string | undefined {
  const spot = [
    site.parkingSpotNumber === undefined ? undefined : t('sites.format.spot', { number: site.parkingSpotNumber }),
    site.garageLevel === undefined ? undefined : t('sites.format.level', { level: site.garageLevel }),
  ].filter((part) => part !== undefined);
  return spot.length === 0 ? undefined : spot.join(', ');
}

/** "Garaż w budynku wielorodzinnym · miejsce 15, poziom -1" — the type of the object and, for a garage, the spot and the level. */
export function formatSiteDetails(t: TFunction, site: SpotFields & Pick<SiteSearchItem, 'siteType'>): string {
  const spot = formatSpot(t, site);
  return spot === undefined ? siteTypeLabels[site.siteType] : `${siteTypeLabels[site.siteType]} · ${spot}`;
}
