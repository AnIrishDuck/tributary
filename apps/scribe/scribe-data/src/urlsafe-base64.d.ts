declare module 'urlsafe-base64' {
  export function encode(buffer: Buffer): string
  export function decode(base64url: string): Buffer
  export function validate(base64url: string): boolean
}
