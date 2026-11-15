import type { FileDeclaration } from './types.ts';

/**
 * What the phone may declare about a file in the upload session (EVM-131 contract `UploadFileDeclaration`; the allow-list of the server,
 * `file-rules.ts`): the type is from the list and the name is made from the identifier of the asset and the extension of the type -
 * NEVER a name from the user. Kotlin has the same table (`UploadTypes`); `conformance/upload/declaration.json` holds both to it.
 */
export const UPLOAD_TYPE_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
});

const ALIASES: Readonly<Record<string, string>> = { 'image/jpg': 'image/jpeg', 'image/heif': 'image/heic' };
const SHA256 = /^[a-f0-9]{64}$/;
const FILE_NAME = /^[A-Za-z0-9-]{1,64}\.[a-z0-9]{1,5}$/;
/** 4 GiB: the limit of a video in the contract. */
export const MAX_DECLARED_BYTES = 4_294_967_296;

/** The type of the allow-list for `value` (case, blanks and the aliases of the server are accepted), or `undefined`. */
export function normalizeUploadType(value: string): string | undefined {
  const lower = value.trim().toLowerCase();
  const type = ALIASES[lower] ?? lower;
  return Object.hasOwn(UPLOAD_TYPE_EXTENSIONS, type) ? type : undefined;
}

/** `<assetId>.<extension of the type>`; a type outside the list gets `bin` (the declaration is then not declarable). */
export function declaredFileName(assetId: string, contentType: string): string {
  return `${assetId}.${UPLOAD_TYPE_EXTENSIONS[contentType] ?? 'bin'}`;
}

/** Can the server accept this declaration: an allow-listed type, a name that matches it, 1 byte to 4 GiB, a lower-case hex SHA-256. */
export function isDeclarable(file: FileDeclaration): boolean {
  const extension = UPLOAD_TYPE_EXTENSIONS[file.contentType];
  return (
    extension !== undefined &&
    FILE_NAME.test(file.fileName) &&
    file.fileName.endsWith(`.${extension}`) &&
    Number.isInteger(file.declaredSize) &&
    file.declaredSize >= 1 &&
    file.declaredSize <= MAX_DECLARED_BYTES &&
    SHA256.test(file.sha256)
  );
}
