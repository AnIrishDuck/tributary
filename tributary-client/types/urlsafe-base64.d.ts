declare module 'urlsafe-base64' {
  export function encode(data: Uint8Array | string): string;
  export function decode(data: string): Uint8Array;
}
