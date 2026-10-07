import type { SiteSearchItem } from '@evia/contracts';
import type { TFunction } from 'i18next';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';

/** "ul. Testowa 7/3, 00-001 Warszawa" — the address as it is read (the apartment after a slash). */
export function formatAddress(site: SiteSearchItem): string {
  const number = site.apartmentNumber === undefined ? site.buildingNumber : `${site.buildingNumber}/${site.apartmentNumber}`;
  return `${site.street} ${number}, ${site.postalCode} ${site.city}`;
}

/** "Garaż w budynku wielorodzinnym · miejsce 15, poziom -1" — the type of the object and, for a garage, the spot and the level. */
export function formatSiteDetails(t: TFunction, site: SiteSearchItem): string {
  const parts = [siteTypeLabels[site.siteType]];
  const spot = [
    site.parkingSpotNumber === undefined ? undefined : t('sites.format.spot', { number: site.parkingSpotNumber }),
    site.garageLevel === undefined ? undefined : t('sites.format.level', { level: site.garageLevel }),
  ].filter((part) => part !== undefined);
  if (spot.length > 0) parts.push(spot.join(', '));
  return parts.join(' · ');
}
