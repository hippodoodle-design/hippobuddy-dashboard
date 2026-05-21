const IV_BYTES = 12

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const normalised = b64.replace(/-/g, '+').replace(/_/g, '/')
  const pad =
    normalised.length % 4 === 0 ? 0 : 4 - (normalised.length % 4)
  const binary = atob(normalised + '='.repeat(pad))
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return buffer
}

export type EncryptedPayload = {
  ciphertext: string
  iv: string
}

export async function encryptString(
  dek: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dek,
    encoded,
  )
  const ivBuffer = new ArrayBuffer(iv.byteLength)
  new Uint8Array(ivBuffer).set(iv)
  return {
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(ivBuffer),
  }
}

export async function decryptString(
  dek: CryptoKey,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const ivBuffer = base64ToBuffer(iv)
  const cipherBuffer = base64ToBuffer(ciphertext)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(ivBuffer) },
    dek,
    cipherBuffer,
  )
  return new TextDecoder().decode(plaintext)
}
